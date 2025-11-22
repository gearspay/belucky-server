// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    lowercase: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [20, 'Username cannot exceed 20 characters'],
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers and underscores']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters']
  },
  role: {
    type: Number,
    default: 2, // 1: admin, 2: user, 3: vip
    enum: [1, 2, 3]
  },
  affiliateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  pin: {
    type: String,
    default: null,
    length: 4
  },
  profile: {
    firstName: {
      type: String,
      default: null
    },
    lastName: {
      type: String,
      default: null
    },
    email: {
      type: String,
      required: [true, 'Email is required'], // ✅ NOW MANDATORY
      unique: true, // ✅ PREVENT DUPLICATE EMAILS
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
    },
    emailVerified: {
      type: Boolean,
      default: false // ✅ TRACK EMAIL VERIFICATION STATUS
    },
    phone: {
      type: String,
      default: null
    },
    avatar: {
      type: String,
      default: null
    }
  },
  gameStats: {
    totalGamesPlayed: {
      type: Number,
      default: 0
    },
    totalWinnings: {
      type: Number,
      default: 0
    },
    totalLosses: {
      type: Number,
      default: 0
    }
  },
  account: {
    isActive: {
      type: Boolean,
      default: true
    },
    lastLogin: {
      type: Date,
      default: null
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }
}, {
  timestamps: true
});

// Indexes for performance
userSchema.index({ username: 1 });
userSchema.index({ 'profile.email': 1 }); // ✅ INDEX FOR EMAIL LOOKUPS
userSchema.index({ affiliateId: 1 });
userSchema.index({ 'account.isActive': 1 });

// Transform output (remove sensitive data)
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.pin;
  return user;
};

module.exports = mongoose.model('User', userSchema);