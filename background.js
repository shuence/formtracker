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
 * Generate AI summary using Gemini 2.5 API
 */
async function generateSummaryWithGemini(apiKey, submissions, formUrl = null) {
  try {
    if (!apiKey) {
      return { success: false, error: 'Gemini API key not configured' };
    }

    // Prepare prompt for Gemini
    let prompt = `You are analyzing form submissions data. Please provide a comprehensive summary:
    
1. Overall Form Analysis:
   - What type of form is this? (e.g., contact form, survey, registration, feedback)
   - What is the purpose of this form based on the fields?
   - What patterns do you notice in the submissions?

2. Key Insights:
   - What are the most common responses or patterns?
   - Any notable trends or anomalies?
   - What valuable information can be extracted?

3. Summary for each submission (if analyzing individual):
   - Brief summary of the submission
   - Key points or highlights
   - Any notable information

Here is the form submission data:

`;

    if (Array.isArray(submissions) && submissions.length > 0) {
      if (submissions.length === 1) {
        // Single submission summary
        const submission = submissions[0];
        prompt += `Form URL: ${submission.url || 'Unknown'}\n`;
        prompt += `Form Title: ${submission.title || 'Untitled'}\n`;
        prompt += `Timestamp: ${submission.timestamp || 'Unknown'}\n`;
        prompt += `Source: ${submission.source || 'Unknown'}\n\n`;
        prompt += `Form Fields and Values:\n${JSON.stringify(submission.fields, null, 2)}\n\n`;
        prompt += `Please provide a concise summary (2-3 sentences) of this submission highlighting key information.`;
      } else {
        // Multiple submissions - form analysis
        prompt += `Analyzing ${submissions.length} submissions from this form:\n\n`;
        if (formUrl) {
          prompt += `Form URL: ${formUrl}\n\n`;
        }
        
        submissions.forEach((sub, index) => {
          prompt += `Submission ${index + 1} (${sub.timestamp || 'Unknown time'}):\n`;
          prompt += `Fields: ${JSON.stringify(sub.fields, null, 2)}\n\n`;
        });
        
        prompt += `Please provide:\n1. A summary of what type of form this is and its purpose\n2. Key patterns and trends across all submissions\n3. Notable insights or findings\n4. Any recommendations or observations`;
      }
    } else {
      return { success: false, error: 'No submission data provided' };
    }

    // Call Gemini API - try Gemini 2.5 Flash, fallback to 2.0 if not available
    const model = 'gemini-2.5-flash'; // Using Gemini 2.5 Flash, fallback to gemini-2.0-flash-exp if needed
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(errorData.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      const summaryText = data.candidates[0].content.parts[0].text;
      return { success: true, summary: summaryText };
    } else {
      return { success: false, error: 'No summary generated from API' };
    }
  } catch (error) {
    console.error('FormTrack: Error generating summary with Gemini', error);
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
      console.debug('FormTrack: Cannot send response, channel closed:', chrome.runtime.lastError.message);
      return false;
    }
    // Check if sendResponse is still a valid function
    if (typeof sendResponse !== 'function') {
      console.debug('FormTrack: sendResponse is not a function');
      return false;
    }
    
    // Attempt to send response
    // Note: Even if this fails, we've attempted to send, which prevents the error
    sendResponse(data);
    return true;
  } catch (error) {
    // Response already sent or channel closed - this is normal when
    // the sender doesn't wait for a response, so we silently ignore it
    console.debug('FormTrack: Error sending response (this is normal if channel closed):', error.message);
    return false;
  }
}

/**
 * Check if sendResponse callback is still valid
 */
function isResponseCallbackValid(sendResponse) {
  try {
    return typeof sendResponse === 'function' && !chrome.runtime.lastError;
  } catch {
    return false;
  }
}

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FORM_SUBMISSION') {
    // Fire-and-forget: content scripts don't wait for responses
    // Process submission in background without blocking
    saveSubmission(message.data).then(async (success) => {
      // Send email notification if enabled (fire-and-forget)
      if (success) {
        sendSubmissionEmail(message.data).catch(err => {
          console.debug('FormTrack: Error sending email notification', err);
        });
      }
    }).catch(error => {
      console.debug('FormTrack: Error saving submission', error);
    });
    
    // Return false - no response needed, prevents channel closing errors
    return false;
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
      // Fire-and-forget: content scripts don't wait for responses
      // Process email sending in background without blocking
      console.debug('FormTrack: Email sent successfully', result);
    }).catch(error => {
      console.debug('FormTrack: Error sending email', error);
    });
    // Return false - no response needed, prevents channel closing errors
    return false;
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
  
  if (message.type === 'GENERATE_SUMMARY') {
    (async () => {
      try {
        const result = await chrome.storage.local.get(['settings']);
        const settings = result.settings || {};
        
        if (!settings.geminiApiKey) {
          // Always attempt to send response, safeSendResponse will handle if callback is invalid
          safeSendResponse(sendResponse, { success: false, error: 'Gemini API key not configured. Please add it in settings.' });
          return;
        }
        
        const summaryResult = await generateSummaryWithGemini(
          settings.geminiApiKey,
          message.submissions,
          message.formUrl || null
        );
        
        // Always attempt to send response, safeSendResponse will handle if callback is invalid
        safeSendResponse(sendResponse, summaryResult);
      } catch (error) {
        console.error('FormTrack: Error in GENERATE_SUMMARY handler', error);
        // Always attempt to send response, safeSendResponse will handle if callback is invalid
        safeSendResponse(sendResponse, { success: false, error: error.message || 'Unknown error' });
      }
    })();
    
    return true; // Keep channel open for async response
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

