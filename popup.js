// FormTrack Popup Script
// Handles UI interactions and displays submissions

let allSubmissions = [];
let filteredSubmissions = [];

// DOM elements
const submissionsList = document.getElementById('submissionsList');
const searchInput = document.getElementById('searchInput');
const statsText = document.getElementById('statsText');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const emptyState = document.getElementById('emptyState');

/**
 * Format timestamp to readable date
 */
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

/**
 * Truncate URL for display
 */
function truncateUrl(url, maxLength = 50) {
  if (!url) return 'Unknown';
  if (url.length <= maxLength) return url;
  
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname;
    const path = urlObj.pathname;
    
    if (host.length + path.length <= maxLength) {
      return host + path;
    }
    
    return host + '...' + path.slice(-(maxLength - host.length - 3));
  } catch {
    return url.slice(0, maxLength - 3) + '...';
  }
}

/**
 * Render a single submission
 */
function renderSubmission(submission, index) {
  const submissionDiv = document.createElement('div');
  submissionDiv.className = 'submission-item';
  submissionDiv.dataset.index = index;

  const timeAgo = formatDate(submission.timestamp);
  const displayUrl = truncateUrl(submission.url, 60);
  const fieldCount = Object.keys(submission.fields || {}).length;
  const isGoogleForm = submission.source === 'google-forms' || 
                       submission.url.includes('docs.google.com/forms/');
  const isMicrosoftForm = submission.source === 'microsoft-forms' ||
                          submission.url.includes('forms.office.com') ||
                          submission.url.includes('forms.microsoft.com') ||
                          submission.url.includes('forms.office365.com');
  const isClickUpForm = submission.source === 'clickup-forms' ||
                        submission.url.includes('forms.clickup.com');

  let sourceBadge = '';
  if (isGoogleForm) {
    sourceBadge = '<span class="source-badge google-forms-badge">Google Forms</span>';
  } else if (isMicrosoftForm) {
    sourceBadge = '<span class="source-badge microsoft-forms-badge">Microsoft Forms</span>';
  } else if (isClickUpForm) {
    sourceBadge = '<span class="source-badge clickup-forms-badge">ClickUp Forms</span>';
  }

  submissionDiv.innerHTML = `
    <div class="submission-header">
      <div class="submission-time">${timeAgo}</div>
      <button class="toggle-btn" data-id="${index}">
        <span class="toggle-icon">▼</span>
      </button>
    </div>
    <div class="submission-url" title="${submission.url}">
      ${displayUrl}
      ${sourceBadge}
    </div>
    <div class="submission-title">${submission.title || 'Untitled Page'}</div>
    <div class="submission-preview">
      <span class="field-count">${fieldCount} field${fieldCount !== 1 ? 's' : ''}</span>
    </div>
    <div class="submission-details" style="display: none;">
      <div class="details-section">
        <strong>Fields:</strong>
        <pre class="fields-json">${JSON.stringify(submission.fields, null, 2)}</pre>
      </div>
      <div class="details-section">
        <strong>Full URL:</strong>
        <div class="full-url">${submission.url}</div>
      </div>
      <div class="details-section">
        <strong>Timestamp:</strong>
        <div>${new Date(submission.timestamp).toLocaleString()}</div>
      </div>
      ${submission.source ? `
      <div class="details-section">
        <strong>Source:</strong>
        <div>${submission.source === 'google-forms' ? 'Google Forms' : 
                (submission.source === 'microsoft-forms' ? 'Microsoft Forms' : 
                (submission.source === 'clickup-forms' ? 'ClickUp Forms' : submission.source))}</div>
      </div>
      ` : ''}
      <div class="details-section ai-summary-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong>🤖 AI Summary:</strong>
          <button class="btn-generate-summary" data-submission-index="${index}" title="Generate AI Summary">
            Generate Summary
          </button>
        </div>
        <div class="ai-summary-content" id="ai-summary-${index}" style="display: none;">
          <div class="ai-summary-loading" style="display: none;">Generating summary...</div>
          <div class="ai-summary-text"></div>
          <div class="ai-summary-error" style="display: none; color: #d32f2f; font-size: 12px; margin-top: 8px;"></div>
        </div>
      </div>
    </div>
  `;

  // Add toggle functionality
  const toggleBtn = submissionDiv.querySelector('.toggle-btn');
  const detailsDiv = submissionDiv.querySelector('.submission-details');
  const toggleIcon = submissionDiv.querySelector('.toggle-icon');

  toggleBtn.addEventListener('click', () => {
    const isCurrentlyHidden = detailsDiv.style.display === 'none' || 
                               window.getComputedStyle(detailsDiv).display === 'none';
    detailsDiv.style.display = isCurrentlyHidden ? 'block' : 'none';
    toggleIcon.textContent = isCurrentlyHidden ? '▲' : '▼';
    toggleBtn.setAttribute('aria-expanded', isCurrentlyHidden ? 'true' : 'false');
  });

  // Add AI summary button functionality
  const generateSummaryBtn = submissionDiv.querySelector('.btn-generate-summary');
  if (generateSummaryBtn) {
    generateSummaryBtn.addEventListener('click', async () => {
      await generateAISummary(index);
    });
  }

  return submissionDiv;
}

/**
 * Render all submissions
 */
function renderSubmissions() {
  submissionsList.innerHTML = '';

  if (filteredSubmissions.length === 0) {
    emptyState.style.display = 'flex';
    submissionsList.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  submissionsList.style.display = 'block';

  filteredSubmissions.forEach((submission, index) => {
    const submissionElement = renderSubmission(submission, index);
    submissionsList.appendChild(submissionElement);
  });
}

/**
 * Update stats
 */
function updateStats() {
  const total = allSubmissions.length;
  const filtered = filteredSubmissions.length;
  
  if (filtered === total) {
    statsText.textContent = `${total} submission${total !== 1 ? 's' : ''}`;
  } else {
    statsText.textContent = `Showing ${filtered} of ${total} submission${total !== 1 ? 's' : ''}`;
  }
}

/**
 * Filter submissions based on search query
 */
function filterSubmissions(query) {
  if (!query || query.trim() === '') {
    filteredSubmissions = [...allSubmissions];
    renderSubmissions();
    updateStats();
    return;
  }

  const lowerQuery = query.toLowerCase();
  
  filteredSubmissions = allSubmissions.filter(submission => {
    // Search in URL
    if (submission.url && submission.url.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    
    // Search in title
    if (submission.title && submission.title.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    
    // Search in field names and values
    if (submission.fields) {
      for (const [key, value] of Object.entries(submission.fields)) {
        if (key.toLowerCase().includes(lowerQuery)) return true;
        if (String(value).toLowerCase().includes(lowerQuery)) return true;
      }
    }
    
    return false;
  });

  renderSubmissions();
  updateStats();
}

/**
 * Load submissions from storage
 */
async function loadSubmissions() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SUBMISSIONS' });
    allSubmissions = response.submissions || [];
    filteredSubmissions = [...allSubmissions];
    
    // Sort by timestamp (newest first)
    allSubmissions.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
    filteredSubmissions.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    renderSubmissions();
    updateStats();
  } catch (error) {
    console.error('Error loading submissions:', error);
    submissionsList.innerHTML = '<div class="error">Error loading submissions</div>';
  }
}

/**
 * Export submissions as JSON
 */
function exportSubmissions() {
  if (allSubmissions.length === 0) {
    alert('No submissions to export');
    return;
  }

  const dataStr = JSON.stringify(allSubmissions, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `formtrack-export-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate AI summary for a submission
 */
async function generateAISummary(submissionIndex) {
  const submission = filteredSubmissions[submissionIndex];
  if (!submission) return;

  const summaryContent = document.getElementById(`ai-summary-${submissionIndex}`);
  const summaryText = summaryContent?.querySelector('.ai-summary-text');
  const summaryLoading = summaryContent?.querySelector('.ai-summary-loading');
  const summaryError = summaryContent?.querySelector('.ai-summary-error');
  const generateBtn = document.querySelector(`[data-submission-index="${submissionIndex}"]`);

  if (!summaryContent || !summaryText || !summaryLoading || !summaryError) return;

  // Show summary section
  summaryContent.style.display = 'block';
  summaryLoading.style.display = 'block';
  summaryText.style.display = 'none';
  summaryError.style.display = 'none';
  summaryText.textContent = '';

  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_SUMMARY',
      submissions: [submission],
      formUrl: submission.url
    });

    if (response.success && response.summary) {
      summaryLoading.style.display = 'none';
      summaryText.style.display = 'block';
      summaryText.textContent = response.summary;
      // Format the text nicely
      summaryText.style.whiteSpace = 'pre-wrap';
      summaryText.style.lineHeight = '1.6';
      summaryText.style.color = '#333';
    } else {
      summaryLoading.style.display = 'none';
      summaryError.style.display = 'block';
      summaryError.textContent = response.error || 'Failed to generate summary';
    }
  } catch (error) {
    console.error('Error generating AI summary:', error);
    summaryLoading.style.display = 'none';
    summaryError.style.display = 'block';
    summaryError.textContent = 'Error: ' + error.message;
  } finally {
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Generate Summary';
    }
  }
}

/**
 * Generate AI summary for all submissions (form analysis)
 */
async function generateFormSummary() {
  if (filteredSubmissions.length === 0) {
    alert('No submissions to analyze');
    return;
  }

  // Show a modal or alert with summary
  const formUrl = filteredSubmissions[0]?.url || null;
  
  try {
    // Show loading state
    const summaryText = 'Generating comprehensive form analysis...';
    if (confirm(`Generate AI summary for ${filteredSubmissions.length} submissions?`)) {
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_SUMMARY',
        submissions: filteredSubmissions,
        formUrl: formUrl
      });

      if (response.success && response.summary) {
        // Show summary in a modal or alert
        const summaryWindow = window.open('', '_blank', 'width=600,height=600');
        summaryWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>AI Form Summary</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; }
              h1 { color: #667eea; }
              pre { white-space: pre-wrap; background: #f5f5f5; padding: 15px; border-radius: 5px; }
            </style>
          </head>
          <body>
            <h1>🤖 AI Form Summary</h1>
            <p><strong>Analyzing ${filteredSubmissions.length} submission(s)</strong></p>
            <hr>
            <pre>${response.summary}</pre>
          </body>
          </html>
        `);
      } else {
        alert('Error: ' + (response.error || 'Failed to generate summary'));
      }
    }
  } catch (error) {
    console.error('Error generating form summary:', error);
    alert('Error: ' + error.message);
  }
}

/**
 * Clear all submissions
 */
async function clearSubmissions() {
  if (allSubmissions.length === 0) {
    return;
  }

  if (!confirm(`Are you sure you want to delete all ${allSubmissions.length} submissions? This cannot be undone.`)) {
    return;
  }

  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_SUBMISSIONS' });
    allSubmissions = [];
    filteredSubmissions = [];
    renderSubmissions();
    updateStats();
    searchInput.value = '';
  } catch (error) {
    console.error('Error clearing submissions:', error);
    alert('Error clearing submissions');
  }
}

// Settings Modal Elements
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const testEmailBtn = document.getElementById('testEmailBtn');
const resendApiKey = document.getElementById('resendApiKey');
const emailTo = document.getElementById('emailTo');
const emailFrom = document.getElementById('emailFrom');
const emailEnabled = document.getElementById('emailEnabled');
const geminiApiKey = document.getElementById('geminiApiKey');
// emailOnSubmit removed - now auto-enabled when emailEnabled is true

/**
 * Load settings from storage
 */
async function loadSettings() {
  // Default settings to ensure we always have values
  const defaultSettings = {
    resendApiKey: '',
    emailTo: '',
    emailFrom: '',
    emailEnabled: true,
    geminiApiKey: ''
  };
  
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    
    // Handle case where response might be undefined or doesn't have settings
    let settings = defaultSettings;
    
    if (response && response.settings && typeof response.settings === 'object') {
      // Merge with defaults to ensure all properties exist
      settings = { ...defaultSettings, ...response.settings };
    } else {
      console.debug('FormTrack: Invalid response format, using defaults', response);
      settings = defaultSettings;
    }
    
    // Load API key
    resendApiKey.value = settings.resendApiKey || '';
    
    // Load recipient email
    emailTo.value = settings.emailTo || '';
    
    // Load from email (optional)
    emailFrom.value = settings.emailFrom || '';
    
    // Load email enabled setting (default to true for auto-send)
    emailEnabled.checked = settings.emailEnabled !== undefined ? settings.emailEnabled : true;
    
    // Load Gemini API key
    if (geminiApiKey) {
      geminiApiKey.value = settings.geminiApiKey || '';
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    // Set defaults on error
    resendApiKey.value = defaultSettings.resendApiKey;
    emailTo.value = defaultSettings.emailTo;
    emailFrom.value = defaultSettings.emailFrom;
    emailEnabled.checked = defaultSettings.emailEnabled;
    if (geminiApiKey) {
      geminiApiKey.value = defaultSettings.geminiApiKey;
    }
  }
}

/**
 * Save settings to storage
 */
async function saveSettings() {
  try {
    const apiKey = resendApiKey.value.trim();
    const toEmail = emailTo.value.trim();
    const fromEmail = emailFrom.value.trim();

    // Basic validation
    if (emailEnabled.checked && (!apiKey || !toEmail)) {
      alert('Please enter both Resend API key and recipient email address to enable email notifications.');
      return;
    }

    // Validate email format if provided
    if (toEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      alert('Please enter a valid recipient email address.');
      return;
    }

    if (fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
      alert('Please enter a valid "from" email address or leave it empty.');
      return;
    }

    const settings = {
      resendApiKey: apiKey,
      emailTo: toEmail,
      emailFrom: fromEmail || null,
      emailEnabled: emailEnabled.checked, // Auto-send when enabled and configured
      geminiApiKey: geminiApiKey ? geminiApiKey.value.trim() : ''
    };

    await chrome.runtime.sendMessage({
      type: 'SET_SETTINGS',
      settings
    });

    alert('Settings saved successfully!');
    settingsModal.style.display = 'none';
  } catch (error) {
    console.error('Error saving settings:', error);
    alert('Error saving settings: ' + error.message);
  }
}

/**
 * Test email functionality
 */
async function testEmail() {
  const apiKey = resendApiKey.value.trim();
  const toEmail = emailTo.value.trim();
  const fromEmail = emailFrom.value.trim();

  if (!apiKey) {
    alert('Please enter your Resend API key');
    return;
  }

  if (!toEmail) {
    alert('Please enter the recipient email address');
    return;
  }

  try {
    testEmailBtn.disabled = true;
    testEmailBtn.textContent = 'Sending...';

    const response = await chrome.runtime.sendMessage({
      type: 'SEND_EMAIL',
      email: {
        to: toEmail,
        from: fromEmail || 'onboarding@resend.dev',
        subject: 'FormTrack Test Email',
        html: `
          <h2>FormTrack Test Email</h2>
          <p>This is a test email from FormTrack to verify your Resend API configuration.</p>
          <p>If you received this email, your settings are configured correctly!</p>
          <hr>
          <small>Sent at ${new Date().toLocaleString()}</small>
        `
      },
      apiKey: apiKey
    });

    if (response.success) {
      alert('Test email sent successfully! Check your inbox.');
    } else {
      alert('Error sending email: ' + (response.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Error sending test email:', error);
    alert('Error sending test email: ' + error.message);
  } finally {
    testEmailBtn.disabled = false;
    testEmailBtn.textContent = 'Test Email';
  }
}

// Settings Modal Event Listeners
settingsBtn.addEventListener('click', () => {
  loadSettings();
  settingsModal.style.display = 'flex';
});

// Auto-send is directly tied to emailEnabled
// When enabled with API key and email configured, emails send automatically

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.style.display = 'none';
});

saveSettingsBtn.addEventListener('click', saveSettings);
testEmailBtn.addEventListener('click', testEmail);

// Close modal when clicking outside
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.style.display = 'none';
  }
});

// Event listeners
searchInput.addEventListener('input', (e) => {
  filterSubmissions(e.target.value);
});

exportBtn.addEventListener('click', exportSubmissions);

clearBtn.addEventListener('click', clearSubmissions);

// AI Summary button
const generateFormSummaryBtn = document.getElementById('generateFormSummaryBtn');
if (generateFormSummaryBtn) {
  generateFormSummaryBtn.addEventListener('click', generateFormSummary);
}

// Load submissions on popup open
loadSubmissions();

