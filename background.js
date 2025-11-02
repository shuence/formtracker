// FormTrack Background Service Worker
// Handles storage and message passing

const MAX_SUBMISSIONS = 200;

// Global error handlers to prevent unhandled promise rejections
// These can cause service worker warnings
self.addEventListener('unhandledrejection', (event) => {
  // Silently handle unhandled promise rejections to prevent console warnings
  console.debug('FormTrack: Unhandled promise rejection', event.reason);
  event.preventDefault(); // Prevent the default browser warning
});

self.addEventListener('error', (event) => {
  // Log errors but don't let them crash the service worker
  console.debug('FormTrack: Service worker error', event.error);
});

/**
 * Initialize storage if needed
 */
async function initStorage() {
  const result = await chrome.storage.local.get(['submissions', 'ignoreList', 'settings']);
  
  if (!result.submissions) {
    await chrome.storage.local.set({ submissions: [] });
  }
  
  if (!result.ignoreList) {
    await chrome.storage.local.set({ ignoreList: [] });
  }

  if (!result.settings) {
    await chrome.storage.local.set({ 
      settings: {
        emailEnabled: true // Enable by default - auto-send when API key and email are configured
      }
    });
  }
}

/**
 * Send email via Resend API
 */
async function sendEmailViaResend(apiKey, emailData) {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: emailData.from || 'onboarding@resend.dev',
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.html || emailData.text
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.error('FormTrack: Error sending email', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send email notification for form submission
 */
async function sendSubmissionEmail(submission) {
  try {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || {};

    // Check if API key and email are configured - if so, auto-send
    if (!settings.resendApiKey || !settings.emailTo) {
      console.debug('FormTrack: Email not configured');
      return { success: false, error: 'Email not configured', skipped: true };
    }

    // Auto-send if email notifications are enabled
    // Once API key and email are configured, it will automatically send emails
    if (settings.emailEnabled === false) {
      return { success: false, skipped: true };
    }

    // Auto-send by default - no additional toggle needed

    // Format submission data for email
    const fieldsHtml = Object.entries(submission.fields || {})
      .map(([key, value]) => {
        const displayValue = Array.isArray(value) ? value.join(', ') : value;
        return `<tr><td><strong>${key}:</strong></td><td>${displayValue}</td></tr>`;
      })
      .join('');

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          table td { padding: 10px; border-bottom: 1px solid #ddd; }
          .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>📋 Form Submission Notification</h2>
          </div>
          <div class="content">
            <p>A new form submission has been captured by FormTrack.</p>
            <h3>Submission Details</h3>
            <table>
              <tr><td><strong>URL:</strong></td><td>${submission.url}</td></tr>
              <tr><td><strong>Title:</strong></td><td>${submission.title || 'Untitled'}</td></tr>
              <tr><td><strong>Timestamp:</strong></td><td>${new Date(submission.timestamp).toLocaleString()}</td></tr>
              ${submission.source ? `<tr><td><strong>Source:</strong></td><td>${submission.source}</td></tr>` : ''}
            </table>
            <h3>Form Fields</h3>
            <table>
              ${fieldsHtml || '<tr><td colspan="2">No fields captured</td></tr>'}
            </table>
            <div class="footer">
              <p>This email was sent automatically by FormTrack Chrome Extension.</p>
              <p>You can view all submissions in the extension popup.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const emailResult = await sendEmailViaResend(settings.resendApiKey, {
      to: settings.emailTo,
      from: settings.emailFrom || 'onboarding@resend.dev',
      subject: `Form Submission: ${submission.title || 'New Submission'}`,
      html: emailHtml
    });

    return emailResult;
  } catch (error) {
    console.error('FormTrack: Error sending submission email', error);
    return { success: false, error: error.message };
  }
}

/**
 * Save form submission to storage
 */
async function saveSubmission(submission) {
  try {
    const result = await chrome.storage.local.get(['submissions']);
    let submissions = result.submissions || [];
    
    // Add new submission at the beginning (latest first)
    submissions.unshift(submission);
    
    // Keep only the most recent MAX_SUBMISSIONS
    if (submissions.length > MAX_SUBMISSIONS) {
      submissions = submissions.slice(0, MAX_SUBMISSIONS);
    }
    
    // Save back to storage
    await chrome.storage.local.set({ submissions });
    
    // Update badge with count (with error handling)
    chrome.action.setBadgeText({ 
      text: submissions.length > 0 ? submissions.length.toString() : '' 
    }).catch(err => {
      // Silently ignore badge update errors (common when service worker is terminating)
      console.debug('FormTrack: Error updating badge', err);
    });
    
    return true;
  } catch (error) {
    console.error('FormTrack: Error saving submission', error);
    return false;
  }
}

/**
 * Helper function to safely send response
 * Prevents errors when message channel is already closed
 */
function safeSendResponse(sendResponse, data) {
  try {
    // Check if there's a runtime error (channel might be closed)
    if (chrome.runtime.lastError) {
      // Channel already closed or error occurred, ignore silently
      return false;
    }
    // Attempt to send response
    sendResponse(data);
    return true;
  } catch (error) {
    // Response already sent or channel closed - this is normal when
    // the sender doesn't wait for a response, so we silently ignore it
    return false;
  }
}

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FORM_SUBMISSION') {
    saveSubmission(message.data).then(async (success) => {
      // Send email notification if enabled
      if (success) {
        sendSubmissionEmail(message.data).catch(err => {
          console.debug('FormTrack: Error sending email notification', err);
        });
      }
      safeSendResponse(sendResponse, { success });
    }).catch(error => {
      safeSendResponse(sendResponse, { success: false, error: error.message });
    });
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'GET_SETTINGS') {
    chrome.storage.local.get(['settings']).then(result => {
      // Ensure settings object always exists with defaults
      const settings = result.settings || {
        emailEnabled: true
      };
      safeSendResponse(sendResponse, { settings });
    }).catch(error => {
      console.error('FormTrack: Error getting settings', error);
      // Return default settings on error
      safeSendResponse(sendResponse, { 
        settings: {
          emailEnabled: true
        } 
      });
    });
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'SET_SETTINGS') {
    chrome.storage.local.set({ settings: message.settings }).then(() => {
      safeSendResponse(sendResponse, { success: true });
    }).catch(error => {
      safeSendResponse(sendResponse, { success: false, error: error.message });
    });
    return true;
  }
  
  if (message.type === 'SEND_EMAIL') {
    sendEmailViaResend(message.apiKey, message.email).then(result => {
      safeSendResponse(sendResponse, result);
    }).catch(error => {
      safeSendResponse(sendResponse, { success: false, error: error.message });
    });
    return true;
  }
  
  if (message.type === 'GET_SUBMISSIONS') {
    chrome.storage.local.get(['submissions']).then(result => {
      safeSendResponse(sendResponse, { submissions: result.submissions || [] });
    }).catch(error => {
      safeSendResponse(sendResponse, { submissions: [], error: error.message });
    });
    return true;
  }
  
  if (message.type === 'CLEAR_SUBMISSIONS') {
    chrome.storage.local.set({ submissions: [] }).then(() => {
      chrome.action.setBadgeText({ text: '' }).catch(() => {
        // Silently ignore badge update errors
      });
      safeSendResponse(sendResponse, { success: true });
    }).catch(error => {
      safeSendResponse(sendResponse, { success: false, error: error.message });
    });
    return true;
  }
  
  if (message.type === 'GET_IGNORE_LIST') {
    chrome.storage.local.get(['ignoreList']).then(result => {
      safeSendResponse(sendResponse, { ignoreList: result.ignoreList || [] });
    }).catch(error => {
      safeSendResponse(sendResponse, { ignoreList: [], error: error.message });
    });
    return true;
  }
  
  if (message.type === 'SET_IGNORE_LIST') {
    chrome.storage.local.set({ ignoreList: message.ignoreList }).then(() => {
      safeSendResponse(sendResponse, { success: true });
    }).catch(error => {
      safeSendResponse(sendResponse, { success: false, error: error.message });
    });
    return true;
  }
  
  // Return false if message type is not handled (no async response needed)
  return false;
});

// Initialize storage on install/startup
chrome.runtime.onInstalled.addListener(() => {
  // Use catch to prevent unhandled promise rejection warnings
  initStorage().catch(err => {
    console.debug('FormTrack: Error initializing storage on install', err);
  });
});

chrome.runtime.onStartup.addListener(() => {
  // Use catch to prevent unhandled promise rejection warnings
  initStorage().catch(err => {
    console.debug('FormTrack: Error initializing storage on startup', err);
  });
});

// Initialize on load (with error handling)
initStorage().catch(err => {
  console.debug('FormTrack: Error initializing storage', err);
});

// Set initial badge count (with error handling)
chrome.storage.local.get(['submissions']).then(result => {
  const count = (result.submissions || []).length;
  if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString() }).catch(err => {
      // Silently ignore badge update errors
      console.debug('FormTrack: Error setting badge', err);
    });
  }
}).catch(err => {
  // Silently ignore storage errors during initialization
  console.debug('FormTrack: Error getting submissions for badge', err);
});

