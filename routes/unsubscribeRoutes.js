// routes/unsubscribeRoutes.js
const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');
const User = require('../models/User');

// @route   GET /api/unsubscribe
// @desc    Show unsubscribe confirmation page
// @access  Public
router.get('/', async (req, res) => {
  const { email } = req.query;
  
  if (!email) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invalid Request - Belucky</title>
        <style>
          body { 
            margin: 0; 
            padding: 0; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; 
            background: #f5f5f5; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            min-height: 100vh; 
          }
          .container { 
            max-width: 500px; 
            margin: 20px; 
            background: #ffffff; 
            border-radius: 16px; 
            padding: 40px; 
            text-align: center; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.1); 
          }
          .logo { 
            width: 120px; 
            margin-bottom: 20px; 
          }
          h1 { 
            color: #ef4444; 
            font-size: 24px; 
            margin: 0 0 15px 0; 
          }
          p { 
            color: #6b7280; 
            font-size: 16px; 
            line-height: 1.6; 
            margin: 0; 
          }
          .back-link { 
            display: inline-block; 
            margin-top: 20px; 
            color: #3b82f6; 
            text-decoration: none; 
            font-weight: 600; 
          }
          .back-link:hover { 
            text-decoration: underline; 
          }
        </style>
      </head>
      <body>
        <div class="container">
          <img src="${process.env.LOGO_URL || 'https://belucky.win/images/logo.png'}" alt="Belucky" class="logo">
          <h1>Invalid Request</h1>
          <p>The unsubscribe link is invalid or incomplete.</p>
          <a href="https://belucky.win" class="back-link">Return to Belucky</a>
        </div>
      </body>
      </html>
    `);
  }

  // Show confirmation page
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Unsubscribe Confirmation - Belucky</title>
      <style>
        body { 
          margin: 0; 
          padding: 0; 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; 
          background: #f5f5f5; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          min-height: 100vh; 
        }
        .container { 
          max-width: 500px; 
          margin: 20px; 
          background: #ffffff; 
          border-radius: 16px; 
          padding: 40px; 
          text-align: center; 
          box-shadow: 0 10px 30px rgba(0,0,0,0.1); 
        }
        .logo { 
          width: 120px; 
          margin-bottom: 20px; 
        }
        .warning-icon { 
          width: 64px; 
          height: 64px; 
          background: #fef3c7; 
          border-radius: 50%; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          margin: 0 auto 20px; 
        }
        .warning-icon svg { 
          width: 36px; 
          height: 36px; 
          stroke: #f59e0b; 
          stroke-width: 2; 
          fill: none; 
        }
        h1 { 
          color: #111827; 
          font-size: 28px; 
          margin: 0 0 15px 0; 
        }
        p { 
          color: #6b7280; 
          font-size: 16px; 
          line-height: 1.6; 
          margin: 0 0 10px 0; 
        }
        .email { 
          color: #374151; 
          font-weight: 600; 
          font-size: 16px; 
          margin: 20px 0; 
        }
        .info-box { 
          background: #f3f4f6; 
          border-radius: 8px; 
          padding: 20px; 
          margin: 20px 0; 
          text-align: left; 
        }
        .info-box p { 
          color: #374151; 
          font-size: 14px; 
          margin: 8px 0; 
          display: flex; 
          align-items: flex-start; 
        }
        .info-box p::before { 
          content: "•"; 
          margin-right: 8px; 
          color: #3b82f6; 
          font-weight: bold; 
        }
        .button-group { 
          display: flex; 
          gap: 15px; 
          margin-top: 30px; 
          justify-content: center; 
        }
        .btn { 
          padding: 14px 32px; 
          border-radius: 8px; 
          font-size: 16px; 
          font-weight: 600; 
          text-decoration: none; 
          cursor: pointer; 
          border: none; 
          transition: all 0.2s; 
        }
        .btn-danger { 
          background: #ef4444; 
          color: white; 
        }
        .btn-danger:hover { 
          background: #dc2626; 
        }
        .btn-secondary { 
          background: #e5e7eb; 
          color: #374151; 
        }
        .btn-secondary:hover { 
          background: #d1d5db; 
        }
      </style>
    </head>
    <body>
      <div class="container">
        <img src="${process.env.LOGO_URL || 'https://belucky.win/images/logo.png'}" alt="Belucky" class="logo">
        <div class="warning-icon">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h1>Unsubscribe from Emails?</h1>
        <p>Are you sure you want to unsubscribe from our mailing list?</p>
        <p class="email">${email}</p>
        
        <div class="info-box">
          <p>You will stop receiving promotional emails and updates</p>
          <p>You'll still receive important account notifications</p>
          <p>You can always resubscribe later</p>
        </div>

        <div class="button-group">
          <form method="POST" action="/api/unsubscribe/confirm" style="display: inline;">
            <input type="hidden" name="email" value="${email}">
            <button type="submit" class="btn btn-danger">Yes, Unsubscribe</button>
          </form>
          <a href="https://belucky.win" class="btn btn-secondary">No, Keep Me Subscribed</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// @route   POST /api/unsubscribe/confirm
// @desc    Process unsubscribe after confirmation
// @access  Public
router.post('/confirm', express.urlencoded({ extended: true }), async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.redirect('/api/unsubscribe');
  }

  try {
    const lowercaseEmail = email.toLowerCase().trim();

    // Remove from Mailtrap contact list
    const mailtrapResult = await emailService.removeFromMailtrapContactList(lowercaseEmail);
    
    // Update user's marketing preference in database
    await User.updateOne(
      { 'profile.email': lowercaseEmail },
      { 
        $set: { 
          'profile.marketingSubscribed': false,
          'profile.unsubscribedAt': new Date()
        } 
      }
    );

    console.log(`✅ User unsubscribed successfully: ${lowercaseEmail}`);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Unsubscribed - Belucky</title>
        <style>
          body { 
            margin: 0; 
            padding: 0; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; 
            background: #f5f5f5; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            min-height: 100vh; 
          }
          .container { 
            max-width: 500px; 
            margin: 20px; 
            background: #ffffff; 
            border-radius: 16px; 
            padding: 40px; 
            text-align: center; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.1); 
          }
          .logo { 
            width: 120px; 
            margin-bottom: 20px; 
          }
          .success-icon { 
            width: 64px; 
            height: 64px; 
            background: #10b981; 
            border-radius: 50%; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            margin: 0 auto 20px; 
          }
          .success-icon svg { 
            width: 36px; 
            height: 36px; 
            stroke: white; 
            stroke-width: 3; 
            fill: none; 
          }
          h1 { 
            color: #111827; 
            font-size: 28px; 
            margin: 0 0 15px 0; 
          }
          p { 
            color: #6b7280; 
            font-size: 16px; 
            line-height: 1.6; 
            margin: 0 0 10px 0; 
          }
          .email { 
            color: #374151; 
            font-weight: 600; 
            font-size: 16px; 
          }
          .note { 
            background: #fef3c7; 
            border-left: 4px solid #f59e0b; 
            padding: 15px; 
            border-radius: 8px; 
            margin: 20px 0; 
            text-align: left; 
          }
          .note p { 
            color: #92400e; 
            font-size: 14px; 
            margin: 0; 
          }
          .back-link { 
            display: inline-block; 
            margin-top: 20px; 
            padding: 14px 32px; 
            background: #3b82f6; 
            color: white; 
            text-decoration: none; 
            font-weight: 600; 
            font-size: 16px; 
            border-radius: 8px; 
            transition: background 0.2s; 
          }
          .back-link:hover { 
            background: #2563eb; 
          }
        </style>
      </head>
      <body>
        <div class="container">
          <img src="${process.env.LOGO_URL || 'https://belucky.win/images/logo.png'}" alt="Belucky" class="logo">
          <div class="success-icon">
            <svg viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <h1>Successfully Unsubscribed</h1>
          <p>You have been removed from our mailing list.</p>
          <p class="email">${email}</p>
          <div class="note">
            <p><strong>Note:</strong> You will no longer receive marketing emails from Belucky. You may still receive important account-related notifications.</p>
          </div>
          <a href="https://belucky.win" class="back-link">Return to Belucky</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error - Belucky</title>
        <style>
          body { 
            margin: 0; 
            padding: 0; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; 
            background: #f5f5f5; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            min-height: 100vh; 
          }
          .container { 
            max-width: 500px; 
            margin: 20px; 
            background: #ffffff; 
            border-radius: 16px; 
            padding: 40px; 
            text-align: center; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.1); 
          }
          .logo { 
            width: 120px; 
            margin-bottom: 20px; 
          }
          h1 { 
            color: #ef4444; 
            font-size: 24px; 
            margin: 0 0 15px 0; 
          }
          p { 
            color: #6b7280; 
            font-size: 16px; 
            line-height: 1.6; 
            margin: 0; 
          }
          .back-link { 
            display: inline-block; 
            margin-top: 20px; 
            color: #3b82f6; 
            text-decoration: none; 
            font-weight: 600; 
          }
          .back-link:hover { 
            text-decoration: underline; 
          }
        </style>
      </head>
      <body>
        <div class="container">
          <img src="${process.env.LOGO_URL || 'https://belucky.win/images/logo.png'}" alt="Belucky" class="logo">
          <h1>Error Processing Request</h1>
          <p>We encountered an error while processing your unsubscribe request. Please try again later or contact support.</p>
          <a href="https://belucky.win" class="back-link">Return to Belucky</a>
        </div>
      </body>
      </html>
    `);
  }
});

module.exports = router;