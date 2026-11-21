
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";

dotenv.config();

import multer from "multer";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});



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

// GET Featured Equipment
app.get("/api/equipment/featured", async (req, res) => {
  try {
    const equipment = await db.collection("equipment")
      .find({ status: "Approved" })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    res.send({ success: true, equipment });
  } catch (error) {
    res.status(500).send({ success: false, message: "Server Error" });
  }
});



// Owner My Equipment Rentals
app.get("/api/bookings/owner/:email", async (req, res) => {
  const email = decodeURIComponent(req.params.email);

  const bookings = await db.collection("bookings")
    .find({ ownerEmail: email })
    .sort({ createdAt: -1 })
    .toArray();
  res.send({ success: true, bookings });
});

// customer favorites api
app.post("/api/favorites", async (req, res) => {
  const { customerName, customerEmail, equipmentId } = req.body;

  const equipment = await db.collection("equipment").findOne({
    _id: new ObjectId(equipmentId),
  });
  const favorite = {
    customerName,
    customerEmail,
    equipmentId,
    equipmentName: equipment.equipmentName,
    category: equipment.category,
    image: equipment.image,
    ownerName: equipment.ownerName,
    ownerEmail: equipment.ownerEmail,
    createdAt: new Date(),
  };
  const result = await db.collection("favorites").insertOne(favorite);
  res.send({ success: true, insertedId: result.insertedId });
});


// Get Customer Favorites
app.get("/api/favorites/:email", async (req, res) => {
  const email = req.params.email;

  const favorites = await db
    .collection("favorites")
    .find({ customerEmail: email })
    .sort({ createdAt: -1 })
    .toArray();

  res.send({
    success: true,
    favorites,
  });
});


// Remove Favorite
app.delete("/api/favorites/:id", async (req, res) => {
  const result = await db.collection("favorites").deleteOne({
    _id: new ObjectId(req.params.id),
  });

  res.send({
    success: result.deletedCount > 0,
    message: result.deletedCount
      ? "Favorite removed successfully"
      : "Favorite not found",
  });
});



// Customer My Rentals
app.get("/api/bookings/customer/:email", async (req, res) => {
  const email = decodeURIComponent(req.params.email);

  const bookings = await db.collection("bookings")
    .find({ customerEmail: email })
    .sort({ createdAt: -1 })
    .toArray();

  res.send({ success: true, bookings });
});

// GET Customer User Profile
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

// POST Customer User Profile
app.post("/api/profile/:email", async (req, res) => {
  const { email } = req.params;
  const { name, phone, address } = req.body;

  await db.collection("user").updateOne(
    { email: decodeURIComponent(email) },
    { $set: { name, phone, address } }
  );

  res.send({ success: true, message: "Profile updated successfully" });
});

// POST Owner Add Equipment
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

// GET Owner My Equipment
app.get("/api/equipment/my-equipment/:email", async (req, res) => {
  const email = decodeURIComponent(req.params.email);

  const equipment = await db.collection("equipment")
    .find({ ownerEmail: email })
    .sort({ createdAt: -1 })
    .toArray();

  res.send({ success: true, equipment });
});

// GET Equipment Details
app.get("/api/equipment/:id", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid equipment ID" });
  }

  const equipment = await db.collection("equipment").findOne({
    _id: new ObjectId(id),
  });

  res.send(equipment);
});

// Update Owner Equipment
app.patch("/api/equipment/:id", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid equipment ID" });
  }

  await db.collection("equipment").updateOne(
    { _id: new ObjectId(id) },
    { $set: req.body }
  );

  res.send({ success: true, message: "Equipment updated" });
});

// Delete Owner Equipment
app.delete("/api/equipment/:id", async (req, res) => {
  const result = await db.collection("equipment").deleteOne({
    _id: new ObjectId(req.params.id),
  });

  res.send({
    success: result.deletedCount > 0,
    message: result.deletedCount ? "Equipment deleted" : "Not found",
  });
});


// GET All Users
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await db.collection("user")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.send({ success: true, users });
  } catch (error) {
    res.status(500).send({ success: false, message: "Server Error" });
  }
});

// Delete User 
app.delete("/api/admin/users/:id", async (req, res) => {
  const result = await db.collection("user").deleteOne({
    _id: new ObjectId(req.params.id),
  });

  res.send({ success: true, result });
});


// Update User Role
app.patch("/api/admin/users/:id/role", async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!ObjectId.isValid(id) || !["customer", "owner", "admin"].includes(role)) {
    return res.status(400).send({ message: "Invalid ID or role" });
  }

  const result = await db.collection("user").updateOne(
    { _id: new ObjectId(id) },
    { $set: { role } }
  );

  if (!result.matchedCount) {
    return res.status(404).send({ message: "User not found" });
  }

  res.send({ success: true, message: "Role updated successfully" });
});





// GET User Profile
app.get("/api/profile/:email", async (req, res) => {
  try {
    const user = await db.collection("user").findOne(
      { email: decodeURIComponent(req.params.email) },
      { projection: { name: 1, email: 1, image: 1, phone: 1, address: 1, role: 1 } }
    );

    if (!user) return res.status(404).send({ message: "User not found" });

    res.send({ success: true, profile: user });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load profile" });
  }
});

// UPDATE User Profile
app.post("/api/profile/:email", async (req, res) => {
  try {
    const { name, image, phone, address } = req.body;
    const email = decodeURIComponent(req.params.email);

    console.log("Incoming image URL:", image);

    const result = await db.collection("user").updateOne(
      { email },
      { $set: { name, image, phone, address } }
    );

    console.log("Modified count:", result.modifiedCount);

    if (!result.matchedCount) {
      return res.status(404).send({ message: "User not found" });
    }

    res.send({
      success: true,
      message: "Profile updated successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to update profile" });
  }
});



// Admin  Profile Image update API
app.post("/api/upload-image", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).send({ message: "Image required" });

  const body = new URLSearchParams({
    image: req.file.buffer.toString("base64"),
  });
  const response = await fetch(
    `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
    { method: "POST", body }
  );


  const data = await response.json();
  if (!data.success) return res.status(500).send({ message: "Upload failed" });
  res.send({ success: true, image: data.data.url });
});



// GET  admin All Equipment page er api
app.get("/api/admin/equipment", async (req, res) => {
  const equipment = await db.collection("equipment")
    .find({})
    .sort({ createdAt: -1 })
    .toArray();

  res.send({ success: true, equipment });
});

// admin All Equipment page er UPDATE / APPROVE / REJECT
app.patch("/api/admin/equipment/:id", async (req, res) => {
  const result = await db.collection("equipment").updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: req.body }
  );

  res.send({ success: result.modifiedCount > 0 });
});

// DELETE Equipment
app.delete("/api/admin/equipment/:id", async (req, res) => {
  const result = await db.collection("equipment").deleteOne({
    _id: new ObjectId(req.params.id),
  });

  res.send({ success: result.deletedCount > 0 });
});




// Start Server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
