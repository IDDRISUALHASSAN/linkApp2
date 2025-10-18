const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String },


  PhoneNumber: { type: String,
     required: true, 
     unique: true },
  password: { type: String,
     required: true },
  otp: { type: String },
  otpExpires: { type: Date },

  isVerified: { type: Boolean, 
    default: false },

    profilePic: { type: String, default: "" },

},
  

{ timestamps: true });
;

module.exports = mongoose.model("User", userSchema);
