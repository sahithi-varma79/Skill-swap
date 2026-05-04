const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const requestRoutes = require("./routes/requests");
const messageRoutes = require("./routes/messages");
const appRoutes = require("./routes/app");
const { ensureUserPublicIds } = require("./utils/migrations");

app.use(express.static(path.join(__dirname, "html")));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/requests", requestRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/app", appRoutes);

// Backward compatibility for previously used /api/login and /api/register paths.
app.use("/api", authRoutes);

app.get("/", (req, res) => {
  res.type("html");
  res.sendFile(path.join(__dirname, "html", "skillswap 2.0"));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) {
    return next(err);
  }

  return res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

const port = Number(process.env.PORT) || 5000;
const host = process.env.HOST || "0.0.0.0";
const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/skillswap";

mongoose
  .connect(mongoUri)
  .then(async () => {
    const migratedUsers = await ensureUserPublicIds();
    console.log(`MongoDB connected (${mongoUri.includes("mongodb://127.0.0.1") ? "local" : "external"})`);
    if (migratedUsers > 0) {
      console.log(`Migrated ${migratedUsers} user(s) with public IDs`);
    }
    app.listen(port, host, () => {
      console.log(`Server listening on ${host}:${port}`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  });
