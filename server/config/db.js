const mongoose = require("mongoose");

async function connectDB(uri = process.env.MONGO_URI) {
  return mongoose.connect(uri);
}

module.exports = connectDB;
