import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider} from "firebase/auth"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_APIKEY,
  authDomain: "interviewiq-3f76b.firebaseapp.com",
  projectId: "interviewiq-3f76b",
  storageBucket: "interviewiq-3f76b.firebasestorage.app",
  messagingSenderId: "316797256436",
  appId: "1:316797256436:web:72ab44dff4ca29a12054a1"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app)

const provider = new GoogleAuthProvider()

export {auth,provider};