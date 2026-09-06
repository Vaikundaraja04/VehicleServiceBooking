function toSafeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    mobile: user.mobile,
    address: user.address,
    role: user.role,
    isEmailVerified: user.isEmailVerified,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

module.exports = { toSafeUser };
