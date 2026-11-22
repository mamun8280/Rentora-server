
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import multer from "multer";
import Stripe from "stripe";

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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


// Stripe Webhook - MUST be before express.json()
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (error) {
      console.error("Webhook signature error:", error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        if (session.payment_status !== "paid") {
          return res.status(200).json({ received: true });
        }

        const pendingBookingId = session.metadata?.pendingBookingId;

        if (!pendingBookingId || !ObjectId.isValid(pendingBookingId)) {
          return res.status(400).json({
            message: "Invalid pending booking ID",
          });
        }

        const pendingBookings = db.collection("pendingBookings");
        const bookings = db.collection("bookings");

        const pendingBooking = await pendingBookings.findOne({
          _id: new ObjectId(pendingBookingId),
          stripeSessionId: session.id,
        });

        // Already processed or booking not found
        if (!pendingBooking) {
          const existingBooking = await bookings.findOne({
            stripeSessionId: session.id,
          });

          if (existingBooking) {
            return res.status(200).json({ received: true });
          }

          return res.status(404).json({
            message: "Pending booking not found",
          });
        }

        const expectedAmount = Math.round(
          pendingBooking.bookingAmount * 100
        );

        if (
          session.amount_total !== expectedAmount ||
          session.currency !== (process.env.STRIPE_CURRENCY || "bdt")
        ) {
          return res.status(400).json({
            message: "Payment amount or currency mismatch",
          });
        }

        const booking = {
          ...pendingBooking,
          _id: new ObjectId(),
          stripeSessionId: session.id,
          stripePaymentIntentId: session.payment_intent,
          paymentStatus: "Paid",
          bookingStatus: "Confirmed",
          paidAt: new Date(),
          createdAt: new Date(),
        };

        delete booking.stripeSessionId;
        booking.stripeSessionId = session.id;

        await bookings.insertOne(booking);

        await pendingBookings.updateOne(
          { _id: pendingBooking._id },
          {
            $set: {
              paymentStatus: "Paid",
              bookingStatus: "Confirmed",
              paidAt: new Date(),
            },
          }
        );
      }

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error("Stripe webhook processing error:", error);
      return res.status(500).json({
        message: "Webhook processing failed",
      });
    }
  }
);




app.use(express.json());



// Create Stripe Checkout Session
app.post("/api/bookings/checkout", async (req, res) => {
  try {
    const {
      equipmentId,
      startDate,
      endDate,
      requiredQuantity,
      contactNumber,
      deliveryAddress,
      notes,
      customerName,
      customerEmail,
    } = req.body;

    if (
      !equipmentId ||
      !ObjectId.isValid(equipmentId) ||
      !startDate ||
      !endDate ||
      !requiredQuantity ||
      !customerName ||
      !customerEmail
    ) {
      return res.status(400).json({
        message: "Please provide all required booking information",
      });
    }

    const quantity = Number(requiredQuantity);

    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({
        message: "Invalid quantity",
      });
    }

    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end < start
    ) {
      return res.status(400).json({
        message: "Invalid rental dates",
      });
    }

    const equipment = await db.collection("equipment").findOne({
      _id: new ObjectId(equipmentId),
      status: "Approved",
    });

    if (!equipment) {
      return res.status(404).json({
        message: "Approved equipment not found",
      });
    }

    if (quantity > Number(equipment.availableQuantity)) {
      return res.status(400).json({
        message: "Requested quantity is not available",
      });
    }

    const rentalDays =
      Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;

    let rentalUnits;

    if (equipment.rentalType === "Weekly") {
      rentalUnits = Math.ceil(rentalDays / 7);
    } else if (equipment.rentalType === "Monthly") {
      rentalUnits = Math.ceil(rentalDays / 30);
    } else {
      rentalUnits = rentalDays;
    }

    const rentalPrice = Number(equipment.rentalPrice);

    if (!Number.isFinite(rentalPrice) || rentalPrice <= 0) {
      return res.status(400).json({
        message: "Invalid equipment rental price",
      });
    }

    const bookingAmount = rentalPrice * rentalUnits * quantity;

    const pendingBooking = {
      equipmentId: equipment._id.toString(),
      equipmentName: equipment.equipmentName,
      equipmentImage: equipment.image || "",
      ownerName: equipment.ownerName || "",
      ownerEmail: equipment.ownerEmail || "",

      customerName,
      customerEmail,

      rentalStartDate: startDate,
      rentalEndDate: endDate,
      requiredQuantity: quantity,

      contactNumber: contactNumber || "",
      deliveryAddress: deliveryAddress || "",
      notes: notes || "",

      rentalDuration: rentalDays,
      rentalPrice,
      rentalType: equipment.rentalType,
      rentalUnits,
      bookingAmount,

      paymentStatus: "Unpaid",
      bookingStatus: "Pending Payment",
      createdAt: new Date(),
    };

    const pendingResult = await db
      .collection("pendingBookings")
      .insertOne(pendingBooking);

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",

        customer_email: customerEmail,

        line_items: [
          {
            price_data: {
              currency: process.env.STRIPE_CURRENCY || "bdt",
              product_data: {
                name: equipment.equipmentName,
                images: equipment.image ? [equipment.image] : [],
                description: `${rentalDays} rental days, quantity ${quantity}`,
              },
              unit_amount: Math.round(bookingAmount * 100),
            },
            quantity: 1,
          },
        ],

        metadata: {
          pendingBookingId: pendingResult.insertedId.toString(),
        },

        success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
      });

      await db.collection("pendingBookings").updateOne(
        { _id: pendingResult.insertedId },
        {
          $set: {
            stripeSessionId: session.id,
          },
        }
      );

      return res.status(200).json({
        success: true,
        checkoutUrl: session.url,
        sessionId: session.id,
      });
    } catch (stripeError) {
      await db.collection("pendingBookings").deleteOne({
        _id: pendingResult.insertedId,
      });

      throw stripeError;
    }
  } catch (error) {
    console.error("Checkout API error:", error);

    return res.status(500).json({
      message: error.message || "Failed to create checkout session",
    });
  }
});



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



// GET Admin All Rentals
app.get("/api/admin/bookings", async (req, res) => {
  try {
    const bookings = await db.collection("bookings")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.send({
      success: true,
      total: bookings.length,
      bookings,
    });
  } catch (error) {
    console.error("Admin All Rentals Error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch all rental bookings",
    });
  }
});





// Start Server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
