import express from "express"
import dotenv from "dotenv"
import connectDb from "./config/connectDb.js"
dotenv.config()
import cors from "cors"
import cookieParser from "cookie-parser"
import authRouter from "./routers/auth.route.js"
import userRouter from "./routers/user.route.js"
import interviewRouter from "./routers/interview.route.js"

const app = express()

app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    next();
});

app.use(cors({
    origin:"http://localhost:5173",
    credentials: true
}))

app.use(express.json())
app.use(cookieParser())

app.use("/api/auth",authRouter)
app.use("/api/user",userRouter)
app.use("/api/interview",interviewRouter)

const PORT = process.env.PORT || 6000

app.get("/", (req, res) => {
    res.send("Backend Working ✅");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server Started on Port ${PORT}`);
    connectDb();
});