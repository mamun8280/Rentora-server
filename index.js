
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import multer from "multer";

dotenv.config();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: [process.env.CLIENT_URL],
  credentials: true,
}));

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

// GET All Approved Equipment (Search, Filter & Sort)
app.get("/api/equipment", async (req, res) => {
  try {
    const {
      search,
      category,
      rentalType,
      minPrice,
      maxPrice,
      availability,
      sort,
    } = req.query;

    const query = { status: "Approved" };

    // Search by equipment name and location
    if (search) {
      const text = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      query.$or = [
        { equipmentName: { $regex: text, $options: "i" } },
        { location: { $regex: text, $options: "i" } },
      ];
    }

    // Category and Rental Type
    if (category && category !== "All") {
      query.category = category;
    }

    if (rentalType && rentalType !== "All") {
      query.rentalType = rentalType;
    }

    // Price Range
    if (minPrice || maxPrice) {
      query.rentalPrice = {};

      if (minPrice) query.rentalPrice.$gte = Number(minPrice);
      if (maxPrice) query.rentalPrice.$lte = Number(maxPrice);
    }

    // Availability
    if (availability === "Available") {
      query.availableQuantity = { $gt: 0 };
    } else if (availability === "Unavailable") {
      query.availableQuantity = { $lte: 0 };
    }

    // Sorting
    const sortOption =
      sort === "price-low"
        ? { rentalPrice: 1 }
        : sort === "price-high"
          ? { rentalPrice: -1 }
          : { createdAt: -1 };

    const equipment = await db.collection("equipment")
      .find(query)
      .sort(sortOption)
      .toArray();

    res.send({
      success: true,
      total: equipment.length,
      equipment,
    });
  } catch (error) {
    console.error("All Equipment Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch equipment",
    });
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

// Customer Favorites
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
  const favorites = await db.collection("favorites")
    .find({ customerEmail: req.params.email })
    .sort({ createdAt: -1 })
    .toArray();

  res.send({ success: true, favorites });
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

// GET User Profile
app.get("/api/profile/:email", async (req, res) => {
  try {
    const user = await db.collection("user").findOne(
      { email: req.params.email },
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
      return res.status(404).send({ message: "User not found" });
    }

    res.send({ success: true, profile: user });
  } catch (error) {
    res.status(500).send({ message: "Server Error" });
  }
});

// UPDATE User Profile
app.post("/api/profile/:email", async (req, res) => {
  try {
    const { name, image, phone, address } = req.body;

    const result = await db.collection("user").updateOne(
      { email: req.params.email },
      { $set: { name, image, phone, address } }
    );

    res.send({ success: result.matchedCount > 0 });
  } catch (error) {
    res.status(500).send({ message: "Update Failed" });
  }
});

// IMAGE UPLOAD
app.post("/api/upload-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send({ message: "No image selected" });
    }

    const formData = new FormData();
    formData.append("image", req.file.buffer.toString("base64"));

    const response = await fetch(
      `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
      { method: "POST", body: formData }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      return res.status(500).send({
        message: result.error?.message || "Image upload failed",
      });
    }

    res.send({ success: true, image: result.data.url });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).send({ message: "Image upload failed" });
  }
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

// GET Admin All Equipment
app.get("/api/admin/equipment", async (req, res) => {
  const equipment = await db.collection("equipment")
    .find({})
    .sort({ createdAt: -1 })
    .toArray();

  res.send({ success: true, equipment });
});

// Admin Update / Approve / Reject Equipment
app.patch("/api/admin/equipment/:id", async (req, res) => {
  const result = await db.collection("equipment").updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: req.body }
  );

  res.send({ success: result.modifiedCount > 0 });
});

// Admin Delete Equipment
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
