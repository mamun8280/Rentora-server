
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: [process.env.CLIENT_URL],
    credentials: true,
  })
);

app.use(express.json());

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI);

let db;

try {
  await client.connect();

  db = client.db("rentora");

  console.log("MongoDB Connected Successfully");
} catch (error) {
  console.error("MongoDB Connection Failed:", error);
  process.exit(1);
}

// Home Route
app.get("/", (req, res) => {
  res.send("Rentora server is running");
});

// GET User Profile
app.get("/api/profile/:email", async (req, res) => {
  const email = decodeURIComponent(req.params.email);

  const user = await db.collection("user").findOne(
    { email: email },
    {
      projection: {
        name: 1,
        email: 1,
        image: 1,
        phone: 1,
        address: 1,
        role: 1,
      },
    }
  );

  if (!user) {
    return res.status(404).send({
      success: false,
      message: "User not found",
    });
  }

  res.send({
    success: true,
    user: {
      name: user.name || "",
      email: user.email || "",
      image: user.image || "",
      phone: user.phone || "",
      address: user.address || "",
      role: user.role || "customer",
    },
  });
});


// POST Update User Profile
app.post("/api/profile/:email", async (req, res) => {
  const email = decodeURIComponent(req.params.email);

  const { name, phone, address } = req.body;

  if (!name?.trim()) {
    return res.status(400).send({
      success: false,
      message: "Name is required",
    });
  }

  const result = await db.collection("user").updateOne(
    { email: email },
    {
      $set: {
        name: name.trim(),
        phone: phone?.trim() || "",
        address: address?.trim() || "",
      },
    }
  );

  if (result.matchedCount === 0) {
    return res.status(404).send({
      success: false,
      message: "User not found",
    });
  }

  res.send({
    success: true,
    message: "Profile updated successfully",
  });
});




// Start Server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
