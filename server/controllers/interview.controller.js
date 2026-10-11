import fs from "fs";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { askAi } from "../services/openRouter.services.js";
import User from "../models/user.model.js";
import Interview from "../models/interview.model.js";

export const analyzeResume = async (req, res) => {
  let filepath;

  try {
    if (!req.file) {
      return res.status(400).json({ message: "Resume Required" });
    }

    filepath = req.file.path;

    // Read PDF
    let fileBuffer;
    try {
      fileBuffer = await fs.promises.readFile(filepath);
    } catch (err) {
      throw new Error("Failed to read uploaded file");
    }

    const uint8Array = new Uint8Array(fileBuffer);

    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
    } catch (err) {
      throw new Error("Invalid PDF file or failed to parse PDF");
    }

    let resumeText = "";
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      resumeText += content.items.map((item) => item.str).join(" ") + "\n";
    }

    resumeText = resumeText.replace(/\s+/g, " ").trim();

    // Ask AI
    const messages = [
      {
        role: "system",
        content: `Extract structured data from resume.
        Return ONLY valid JSON (no extra text):
        {
          "role": "string",
          "experience": "string",
          "projects": ["project1","project2"],
          "skills": ["skill1","skill2"]
        }`,
      },
      { role: "user", content: resumeText },
    ];

    const aiResponse = await askAi(messages);

    // Clean AI response
    const cleaned = aiResponse?.match(/\{[\s\S]*\}/)?.[0];
    if (!cleaned) {
      console.error("AI returned invalid JSON:", aiResponse);
      throw new Error("AI returned invalid JSON format");
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error("JSON Parse Error:", cleaned, err);
      throw new Error("Failed to parse AI JSON response");
    }

    res.json({
      role: parsed.role || "Not detected",
      experience: parsed.experience || "Not detected",
      projects: parsed.projects || [],
      skills: parsed.skills || [],
      resumeText,
    });
  } catch (error) {
    console.error("Controller Error:", error);

    // Safe cleanup
    if (filepath && fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    return res.status(500).json({ message: error.message });
  }
};

export const generateQuestion = async (req, res) => {
  try {
    let { role, experience, mode, resumeText, projects, skills } = req.body;
    role = role?.trim();
    experience = experience?.trim();
    mode = mode?.trim();

    if (!role || !experience || !mode) {
      return res
        .status(400)
        .json({ message: "Role, Experience and Mode are required." });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    // if (user.credits < 50) {
    //   return res.status(404).json({
    //     message: "Not enough credits. Minimum 50 required.",
    //   });
    // }

    const projectText =
      Array.isArray(projects) && projects.length ? projects.join(", ") : "None";

    const skillText =
      Array.isArray(skills) && skills.length ? skills.join(", ") : "None";

    const safeResume = resumeText?.trim() || "None";

    const userPrompt = `
    Role: ${role}
    Experience: ${experience}
    InterviewMode: ${mode}
    Projects: ${projectText}
    Skills: ${skillText}
    Resume: ${safeResume}
    `;

    if (!userPrompt.trim()) {
      return res.status(400).json({
        message: "Prompt content is empty.",
      });
    }

    const messages = [
      {
        role: "system",
        content: `
        You are a real human interviewer conducting a professional interview.

        Speak in simple, natural English as if you are directly talking to the candidate.

        Generate exactly 5 interview questions.

        Strict Rules:
          - Each question must contain between 15 and 25 words.
          - Each question must be a single complete sentence.
          - Do NOT number them.
          - Do NOT add explanations.
          - Do NOT add extra text before or after.
          - One question per line only.
          - Keep language simple and conversational.
          - Questions must feel practical and realistic.

        Difficulty progression:
        Question 1 → easy  
        Question 2 → easy  
        Question 3 → medium  
        Question 4 → medium  
        Question 5 → hard  

        Make questions based on the candidate's role, experience,interviewMode, projects, skills, and resume details.
      `,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ];

    let aiResponse;
    try {
      aiResponse = await askAi(messages);
    } catch (err) {
      return res.status(500).json({
        message: "AI service failed. Try again later.",
      });
    }

    if (!aiResponse || !aiResponse.trim()) {
      return res.status(500).json({
        message: "AI returned empty response.",
      });
    }

    const questionArray = aiResponse
      .split("\n")
      .map((q) => q.trim())
      .filter((q) => q.length > 0)
      .slice(0, 5);

    if (questionArray.length === 0) {
      return res.status(500).json({
        message: "AI failed to generate questions.",
      });
    }

    user.credits -= 50;
    await user.save();

    const interview = await Interview.create({
      userId: user._id,
      role,
      experience,
      mode,
      resumeText: safeResume,
      questions: questionArray.map((q, index) => ({
        question: q,
        difficulty: ["easy", "easy", "medium", "medium", "hard"][index],
        timeLimit: [60, 60, 90, 90, 120][index],
      })),
    });

    res.json({
      interviewId: interview._id,
      creditsLeft: user.credits,
      userName: user.name,
      questions: interview.questions,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `failed to create interview ${error}` });
  }
};

export const submitAnswer = async (req, res) => {
  try {
    const { interviewId, questionIndex, answer, timeTaken } = req.body;

    const interview = await Interview.findById(interviewId);
    const question = interview.questions[questionIndex];

    if (!answer) {
      question.score = 0;
      question.feedback = "You did not submit an answer: ";
      question.answer = "";

      await interview.save();

      return res.json({
        feedback: question.feedback,
      });
    }

    if (timeTaken > question.timeLimit) {
      question.score = 0;
      question.feedback = "Time limit exceeded. Answer not evaluated.";
      question.answer = answer;

      await interview.save();

      return res.json({
        feedback: question.feedback,
      });
    }

    const messages = [
      {
        role: "system",
        content: `
        You are a professional human interviewer evaluating a candidate's answer in a real interview.

        Evaluate naturally and fairly, like a real person would.

        Score the answer in these areas (0 to 10):

        1. Confidence - Does the answer sound clear, confident, and well-presented?
        2. Communication - Is the language simple, clear, and easy to understand?
        3. Correctness - Is the answer accurate, relevant, and complete?

        Rules:
        - Be realistic and unbiased.
        - Do not give random high scores.
        - If the answer is weak, score low.
        - If the answer is strong and detailed, score high.
        - Consider clarity, structure, and relevance.

      Calculate:
      finalScore = average of confidence, communication, and correctness (rounded to nearest whole number).

      Feedback Rules:
      - Write natural human feedback.
      - 10 to 15 words only.
      - Sound like real interview feedback.
      - Can suggest improvement if needed.
      - Do NOT repeat the question.
      - Do NOT explain scoring.
      - Keep tone professional and honest.

    Return ONLY valid JSON in this format:

    {
      "confidence": number,
      "communication": number,
      "correctness": number,
      "finalScore": number,
      "feedback": "short human feedback"
    }
    `,
      },
      {
        role: "user",
        content: `
        Question: ${question.question}
        Answer: ${answer}
        `,
      },
    ];

    const aiResponse = await askAi(messages);

    const cleaned = aiResponse?.match(/\{[\s\S]*\}/)?.[0];

    if (!cleaned) {
      throw new Error("Invalid AI JSON");
    }

    const parsed = JSON.parse(cleaned);
  
    question.answer = answer;
    question.correctness = Number(parsed.correctness ?? 0);
    question.confidence = Number(parsed.confidence ?? 0);
    question.communication = Number(parsed.communication ?? 0);
    question.score = Number(parsed.finalScore ?? 0);
    question.feedback = parsed.feedback ?? "No feedback available";
    await interview.save();

    return res.status(200).json({ feedback: parsed.feedback });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `failed to submit answer ${error}` });
  }
};

export const finishInterview = async (req, res) => {
  try {
    const { interviewId } = req.body;
    const interview = await Interview.findById(interviewId);
    if (!interview) {
      return res.status(400).json({ message: "failed to find Interview" });
    }

    const totalQuestions = interview.questions.length;

    let totalScore = 0;
    let totalConfidence = 0;
    let totalCommunication = 0;
    let totalCorrectness = 0;

    interview.questions.forEach((q) => {
      totalScore += q.score || 0;
      totalConfidence += q.confidence || 0;
      totalCommunication += q.communication || 0;
      totalCorrectness += q.correctness || 0;
    });

    const finalScore = totalQuestions ? totalScore / totalQuestions : 0;
    const avgConfidence = totalQuestions ? totalConfidence / totalQuestions : 0;
    const avgCommunication = totalQuestions
      ? totalCommunication / totalQuestions
      : 0;
    const avgCorrectness = totalQuestions
      ? totalCorrectness / totalQuestions
      : 0;

    interview.finalScore = finalScore;
    interview.status = "completed";

    await interview.save();

    return res.status(200).json({
      finalScore: Number(finalScore.toFixed(1)),
      confidence: Number(avgConfidence.toFixed(1)),
      communication: Number(avgCommunication.toFixed(1)),
      correctness: Number(avgCorrectness.toFixed(1)),
      questionWiseScore: interview.questions.map((q) => ({
        question: q.question,
        score: q.score || 0,
        feedback: q.feedback || "",
        confidence: q.confidence || 0,
        communication: q.communication || 0,
        correctness: q.correctness || 0,
      })),
    });
  } catch (error) {
    console.error("Error in finishInterview:", error);
    return res
      .status(500)
      .json({ message: `failed to finish Interview ${error.message}` });
  }
};

export const getMyInterviews = async (req, res) => {
  try {
    const interviews = await Interview.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .select("role experience mode finalScore status createdAt");
    return res.status(200).json(interviews);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `failed to find currentUser Interview ${error}` });
  }
};

export const getInterviewReport = async (req, res) => {
  try {
    const interview = await Interview.findById(req.params.id);

    if (!interview) {
      return res.status(404).json({ message: "Interview not found" });
    }

    const totalQuestions = interview.questions.length;

    let totalConfidence = 0;
    let totalCommunication = 0;
    let totalCorrectness = 0;

    interview.questions.forEach((q) => {
      totalConfidence += q.confidence || 0;
      totalCommunication += q.communication || 0;
      totalCorrectness += q.correctness || 0;
    });

    const avgConfidence = totalQuestions ? totalConfidence / totalQuestions : 0;
    const avgCommunication = totalQuestions
      ? totalCommunication / totalQuestions
      : 0;
    const avgCorrectness = totalQuestions
      ? totalCorrectness / totalQuestions
      : 0;
    
    return res.json({
      finalScore: interview.finalScore,
      confidence: Number(avgConfidence.toFixed(1)),
      communication: Number(avgCommunication.toFixed(1)),
      correctness: Number(avgCorrectness.toFixed(1)),
      questionWiseScore: interview.questions.map((q) => ({
        question: q.question,
        score: q.score || 0,
        feedback: q.feedback || "",
        confidence: q.confidence || 0,
        communication: q.communication || 0,
        correctness: q.correctness ?? q.correction ?? 0,
      })),
    });
  } catch (error) {
    return res.status(500).json({
      message: `failed to find currentUser Interview report ${error}`,
    });
  }
};
