import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { MongoClient, ServerApiVersion } from "mongodb";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(
  cors({
    origin: [process.env.CLIENT_URL],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// MongoDB connection
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("rentora");

    // Collections (porer step e ei gula use korbo)
    const usersCollection = db.collection("users");
    const equipmentCollection = db.collection("equipment");
    const bookingsCollection = db.collection("bookings");
    const paymentsCollection = db.collection("payments");
    const favoritesCollection = db.collection("favorites");
    const reviewsCollection = db.collection("reviews");

    await db.command({ ping: 1 });
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}
run();

// Root route
app.get("/", (req, res) => {
  res.send("Rentora server is running");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});