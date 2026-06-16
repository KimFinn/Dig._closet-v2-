const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {v4: uuidv4} = require('uuid');
const {User} = require('../database/models');
const logger = require('../utils/logger');

class AuthController {
    // User Registration
    async register(req,res,next) {
        try {
            const {email,password,fullName} = req.body;
            //Check if user already exists
            const existingUser = await User.findOne({where: {email}});
            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    message: 'Email already exists'
                });
            }

            //Hash the password
            const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 10);
            const hashedPassword = await bcrypt.hash(password,salt);

            //Create new user
            const newUser = await User.create({
                id: uuidv4(),
                email,
                password: hashedPassword,
                fullName,
                isActive: true
            });

            logger.info(`New user registered: ${email}`);

             res.status(201).json({
                success: true,
                message: 'User registered successfully',
                user: {
                    id: newUser.id,
                    email: newUser.email,
                    fullName: newUser.fullName,
                    createdAt: newUser.createdAt
                }
            });
        } catch (error) {
            logger.error('Error during user registration:', error);
            next(error);
        }
    }

    // User Login
    async login(req,res,next) {
        try {
            const {email,password} = req.body;

            //Find user by email
            const user = await User.findOne({where: {email}});
            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password'
                });
            }

            //Check if user is active
            if (!user.isActive) {
                return res.status(403).json({
                    success: false,
                    message: 'User account is inactive. Please contact support.'
                });
            }

            //Verify password
            const isPasswordValid = await bcrypt.compare(password,user.password);
            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password'
                });
            }

            //Update last login
            await user.update({lastLogin: new Date()});

            //Generate JWT token
            const token = jwt.sign(
                {
                    userId: user.id,
                    email: user.email
                },
                process.env.JWT_SECRET,
                {
                    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
                }
            );

            logger.info(`User logged in: ${email}`);

            res.status(200).json({
                success: true,
                message: 'Login successful',
               data: {
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    createdAt: user.createdAt,
                    lastLogin: user.lastLogin
                },
                token,
            },
            });
        } catch (error) {
            logger.error('Error during user login:', error);
            next(error);
        }
    }

    /**
   * Get current user profile
   */
  async getProfile(req, res, next) {
    try {
      const userId = req.user.userId;

      const user = await User.findByPk(userId, {
        attributes: ['id', 'email', 'fullName', 'createdAt', 'lastLogin', 'isActive'],
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      res.json({
        success: true,
        data: {
          user,
        },
      });
    } catch (error) {
      logger.error('Get profile error:', error);
      next(error);
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(req, res, next) {
    try {
      const userId = req.user.userId;
      const { fullName } = req.body;

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // Update allowed fields
      if (fullName !== undefined) {
        user.fullName = fullName;
      }

      await user.save();

      logger.info('Profile updated', { userId });

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
          },
        },
      });
    } catch (error) {
      logger.error('Update profile error:', error);
      next(error);
    }
  }

  /**
   * Change password
   */
  async changePassword(req, res, next) {
    try {
      const userId = req.user.userId;
      const { currentPassword, newPassword } = req.body;

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect',
        });
      }

      // Hash new password
      const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 10);
      const newPasswordHash = await bcrypt.hash(newPassword, salt);

      // Update password
      await user.update({ passwordHash: newPasswordHash });

      logger.info('Password changed', { userId });

      res.json({
        success: true,
        message: 'Password changed successfully',
      });
    } catch (error) {
      logger.error('Change password error:', error);
      next(error);
    }
  }

  /**
   * Logout (client-side - invalidate token)
   */
  async logout(req, res) {
    logger.info('User logged out', { userId: req.user.userId });

    res.json({
      success: true,
      message: 'Logout successful',
    });
  }

  /**
   * Refresh token
   */
  async refreshToken(req, res, next) {
    try {
      const userId = req.user.userId;

      const user = await User.findByPk(userId);
      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token',
        });
      }

      // Generate new token
      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
        },
        process.env.JWT_SECRET || 'dev-secret-key',
        {
          expiresIn: process.env.JWT_EXPIRY || '24h',
        }
      );

      res.json({
        success: true,
        message: 'Token refreshed',
        data: { token },
      });
    } catch (error) {
      logger.error('Refresh token error:', error);
      next(error);
    }
  }
}

module.exports = new AuthController();