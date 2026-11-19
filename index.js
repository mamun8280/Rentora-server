
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";

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

// GET customer User Profile
app.get("/api/profile/:email", async (req, res) => {
  const user = await db.collection("user").findOne(
    { email: decodeURIComponent(req.params.email) },
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

  res.send(user);
});


// POST customer  User Profile
app.post("/api/profile/:email", async (req, res) => {
  const { email } = req.params;
  const { name, phone, address } = req.body;

  await db.collection("user").updateOne(
    { email },
    { $set: { name, phone, address } }
  );

  res.send({ success: true, message: "Profile updated successfully" });
});


// POST owner API — Add Equipment
app.post("/api/equipment", async (req, res) => {
  const equipmentData = req.body;

  const result = await db.collection("equipment").insertOne({
    ...equipmentData,
    status: "Pending",
    createdAt: new Date(),
  });

  res.send({
    success: true,
    message: "Equipment added successfully",
    insertedId: result.insertedId,
  });
});


// GET owner My Equipment
app.get("/api/equipment/my-equipment/:email", async (req, res) => {
  const email = decodeURIComponent(req.params.email);

  const equipment = await db.collection("equipment")
    .find({ ownerEmail: email })
    .sort({ createdAt: -1 })
    .toArray();

  res.send({
    success: true,
    equipment,
  });
});

// GET Detail owner Equipment
app.get("/api/equipment/:id", async (req, res) => {
  const { id } = req.params;

  const equipment = await db.collection("equipment").findOne({
    _id: new ObjectId(id),
  });

  res.send(equipment);
});


// update owner Equipment
app.patch("/api/equipment/:id", async (req, res) => {
  const { id } = req.params;

  await db.collection("equipment").updateOne(
    { _id: new ObjectId(id) },
    { $set: req.body }
  );

  res.send({ success: true, message: "Equipment updated" });
});



// Start Server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
