// FormTrack Content Script
// Captures form submissions and sends to background worker

(function() {
  'use strict';

  // Maximum number of submissions to store
  const MAX_SUBMISSIONS = 200;

  // Ignore list of domains/patterns (users can customize later)
  const DEFAULT_IGNORE_PATTERNS = [
    /login/i,
    /signin/i,
    /password/i,
    /auth/i,
    /bank/i,
    /credit/i,
    /payment/i
  ];

  /**
   * Safely send message to background script
   * Checks if chrome.runtime is available before sending
   * Handles "Extension context invalidated" errors gracefully
   */
  function safeSendMessage(message) {
    try {
      // Check if chrome.runtime is available
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        console.debug('FormTrack: chrome.runtime not available');
        return Promise.resolve();
      }
      
      // Check if extension context is still valid by accessing chrome.runtime.id
      // This will throw if context is invalidated
      try {
        const extensionId = chrome.runtime.id;
        if (!extensionId) {
          console.debug('FormTrack: Extension context invalidated (no ID)');
          return Promise.resolve();
        }
      } catch (e) {
        // Context invalidated - accessing chrome.runtime.id threw an error
        console.debug('FormTrack: Extension context invalidated');
        return Promise.resolve();
      }
      
      // Check if sendMessage exists
      if (!chrome.runtime.sendMessage) {
        console.debug('FormTrack: chrome.runtime.sendMessage not available');
        return Promise.resolve();
      }
      
      // Attempt to send message
      return chrome.runtime.sendMessage(message).catch(err => {
        // Handle specific "Extension context invalidated" error
        const errorMessage = err?.message || err?.toString() || '';
        if (errorMessage.includes('Extension context invalidated') || 
            errorMessage.includes('context invalidated')) {
          console.debug('FormTrack: Extension context invalidated, message not sent');
          return Promise.resolve();
        }
        // Silently fail if background script isn't ready
        console.debug('FormTrack: Could not send message', err);
        return Promise.resolve();
      });
    } catch (error) {
      // Handle "Extension context invalidated" and other errors
      const errorMessage = error?.message || error?.toString() || '';
      if (errorMessage.includes('Extension context invalidated') || 
          errorMessage.includes('context invalidated')) {
        console.debug('FormTrack: Extension context invalidated');
      } else {
        console.debug('FormTrack: Error accessing chrome.runtime', error);
      }
      return Promise.resolve();
    }
  }

  /**
   * Check if a URL or form action should be ignored
   */
  function shouldIgnore(url, action) {
    const urlStr = (url || '').toLowerCase();
    const actionStr = (action || '').toLowerCase();
    
    for (const pattern of DEFAULT_IGNORE_PATTERNS) {
      if (pattern.test(urlStr) || pattern.test(actionStr)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Extract form data, excluding password fields
   */
  function extractFormData(form) {
    const formData = {};
    const formElements = form.elements;

    for (let i = 0; i < formElements.length; i++) {
      const element = formElements[i];
      
      // Skip if no name attribute
      if (!element.name) continue;
      
      // Skip password fields
      if (element.type === 'password') continue;
      
      // Skip disabled fields
      if (element.disabled) continue;
      
      // Handle different input types
      let value = null;
      
      if (element.type === 'checkbox' || element.type === 'radio') {
        if (element.checked) {
          value = element.value || 'checked';
        } else {
          continue; // Skip unchecked checkboxes/radios
        }
      } else if (element.type === 'file') {
        value = element.files.length > 0 
          ? `${element.files.length} file(s) selected` 
          : null;
        if (!value) continue;
      } else if (element.tagName === 'SELECT') {
        value = element.value;
      } else {
        value = element.value;
      }
      
      // Only store non-empty values
      if (value !== null && value !== '' && value !== undefined) {
        // Handle multiple values with same name (checkboxes, etc.)
        if (formData[element.name]) {
          if (Array.isArray(formData[element.name])) {
            formData[element.name].push(value);
          } else {
            formData[element.name] = [formData[element.name], value];
          }
        } else {
          formData[element.name] = value;
        }
      }
    }
    
    return formData;
  }

  /**
   * Capture form submission
   */
  function captureFormSubmission(event) {
    const form = event.target;
    
    // Get form action URL
    const actionUrl = form.action || window.location.href;
    const pageUrl = window.location.href;
    
    // Check if we should ignore this form
    if (shouldIgnore(pageUrl, actionUrl)) {
      return;
    }
    
    // Extract form data
    const formData = extractFormData(form);
    
    // Skip if no data was captured
    if (Object.keys(formData).length === 0) {
      return;
    }
    
    // Create submission object
    const submission = {
      url: pageUrl,
      action: actionUrl || pageUrl,
      timestamp: new Date().toISOString(),
      fields: formData,
      title: document.title || 'Untitled Page'
    };
    
    // Send to background worker
    safeSendMessage({
      type: 'FORM_SUBMISSION',
      data: submission
    });
  }

  /**
   * Check if current page is a Google Form
   */
  function isGoogleForm() {
    return window.location.hostname.includes('docs.google.com') &&
           window.location.pathname.includes('/forms/');
  }

  /**
   * Check if current page is a Microsoft Form
   */
  function isMicrosoftForm() {
    const hostname = window.location.hostname.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    
    return (hostname.includes('forms.office.com') ||
            hostname.includes('forms.microsoft.com') ||
            hostname.includes('forms.office365.com'));
  }

  /**
   * Check if current page is a ClickUp Form
   */
  function isClickUpForm() {
    const hostname = window.location.hostname.toLowerCase();
    
    return hostname.includes('forms.clickup.com');
  }

  /**
   * Extract data from Google Forms
   */
  function extractGoogleFormData() {
    const formData = {};
    const questionData = {};
    
    try {
      // Method 1: Try to find form fields in Google Forms structure
      // Google Forms uses various class names, try multiple selectors
      const selectors = [
        '[data-item-id]',
        '[data-params]',
        '.freebirdFormviewerViewItemsItemItem',
        '[jsname]',
        'input[type="text"], input[type="email"], input[type="number"], input[type="date"], input[type="time"]',
        'textarea',
        'select'
      ];

      // Find all form elements
      const inputs = document.querySelectorAll('input, textarea, select, [data-item-id]');
      
      inputs.forEach((element, index) => {
        try {
          let fieldName = null;
          let fieldValue = null;
          let questionText = null;

          // Try to get question text (label)
          const label = element.closest('[data-item-id]')?.querySelector('[role="heading"], .freebirdFormviewerViewItemsItemItemTitle, label, .mdc-text-field__label');
          questionText = label?.textContent?.trim() || `Question ${index + 1}`;

          // Handle different input types
          if (element.type === 'text' || element.type === 'email' || element.type === 'number' || element.type === 'date' || element.type === 'time') {
            fieldName = element.getAttribute('name') || element.getAttribute('aria-label') || questionText;
            fieldValue = element.value;
          } else if (element.type === 'checkbox' || element.type === 'radio') {
            if (element.checked) {
              fieldName = element.getAttribute('name') || questionText;
              fieldValue = element.value || element.getAttribute('aria-label') || 'selected';
              
              // Group radio buttons and checkboxes by question
              if (!formData[fieldName]) {
                formData[fieldName] = [];
              }
              if (Array.isArray(formData[fieldName])) {
                formData[fieldName].push(fieldValue);
              } else {
                formData[fieldName] = [formData[fieldName], fieldValue];
              }
              return;
            }
          } else if (element.tagName === 'TEXTAREA') {
            fieldName = element.getAttribute('name') || questionText;
            fieldValue = element.value;
          } else if (element.tagName === 'SELECT') {
            fieldName = element.getAttribute('name') || questionText;
            fieldValue = element.value;
          }

          // Try to extract from data attributes (Google Forms specific)
          const dataItemId = element.closest('[data-item-id]')?.getAttribute('data-item-id');
          if (dataItemId && !fieldName) {
            fieldName = `question_${dataItemId}`;
          }

          // Only store if we have a name and value
          if (fieldName && fieldValue !== null && fieldValue !== '') {
            // Use question text as key if available, otherwise use field name
            const key = questionText !== `Question ${index + 1}` ? questionText : fieldName;
            
            if (!formData[key]) {
              formData[key] = fieldValue;
            } else if (Array.isArray(formData[key])) {
              formData[key].push(fieldValue);
            } else {
              formData[key] = [formData[key], fieldValue];
            }
            
            // Store metadata
            questionData[key] = {
              value: fieldValue,
              type: element.type || element.tagName.toLowerCase()
            };
          }
        } catch (err) {
          // Skip this element
        }
      });

      // Method 2: Try to capture from Google Forms' internal state
      // Look for form data in window object or global variables
      try {
        if (window._gfp && window._gfp.response) {
          Object.assign(formData, window._gfp.response);
        }
      } catch (e) {
        // Ignore
      }

      return formData;
    } catch (err) {
      console.debug('FormTrack: Error extracting Google Form data', err);
      return {};
    }
  }

  /**
   * Capture Google Form submission
   */
  function captureGoogleFormSubmission() {
    if (!isGoogleForm()) return;
    
    // Try multiple times with delays to capture data
    let attempts = 0;
    const maxAttempts = 3;
    
    function attemptCapture() {
      attempts++;
      const formData = extractGoogleFormData();
      
      if (Object.keys(formData).length === 0 && attempts < maxAttempts) {
        // Retry after a short delay
        setTimeout(attemptCapture, 300);
        return;
      }
      
      // If still no data after attempts, try to capture from form inputs directly
      if (Object.keys(formData).length === 0) {
        // Last resort: capture visible form inputs
        const allInputs = document.querySelectorAll('input[value]:not([type="submit"]):not([type="button"]), textarea[value], select option:checked');
        allInputs.forEach(input => {
          const value = input.value || input.textContent;
          const name = input.getAttribute('name') || input.getAttribute('aria-label') || input.closest('[data-item-id]')?.querySelector('[role="heading"]')?.textContent || `Field_${Object.keys(formData).length + 1}`;
          if (value && value.trim()) {
            formData[name] = value;
          }
        });
      }
      
      if (Object.keys(formData).length === 0) {
        console.debug('FormTrack: No Google Form data captured');
        return;
      }

      const submission = {
        url: window.location.href,
        action: window.location.href,
        timestamp: new Date().toISOString(),
        fields: formData,
        title: document.title || 'Google Form',
        source: 'google-forms'
      };

      safeSendMessage({
        type: 'FORM_SUBMISSION',
        data: submission
      });
    }
    
    attemptCapture();
  }

  /**
   * Monitor Google Forms submit button
   */
  function setupGoogleFormMonitoring() {
    if (!isGoogleForm()) return;

    // Watch for submit button clicks - expanded selectors for Google Forms
    const submitButtonSelectors = [
      '[jsname="M2UYVd"]', // Common Google Forms submit button
      '[jsname*="Submit"]',
      '.freebirdFormviewerViewNavigationSubmitButton',
      '[class*="SubmitButton"]',
      '[class*="submitButton"]',
      'button[type="submit"]',
      '[role="button"][aria-label*="Submit"]',
      '[role="button"][aria-label*="submit"]',
      '[role="button"][aria-label*="Submit response"]',
      'button:has-text("Submit")',
      'div[role="button"]:has-text("Submit")'
    ];

    function attachListeners() {
      submitButtonSelectors.forEach(selector => {
        try {
          const buttons = document.querySelectorAll(selector);
          buttons.forEach(button => {
            if (!button.dataset.formtrackWatched) {
              button.dataset.formtrackWatched = 'true';
              // Use capture phase to intercept early
              button.addEventListener('click', (e) => {
                console.debug('FormTrack: Google Form submit button clicked');
                // Capture immediately and also after delay
                setTimeout(captureGoogleFormSubmission, 100);
                setTimeout(captureGoogleFormSubmission, 800);
                setTimeout(captureGoogleFormSubmission, 1500);
              }, true);
              
              // Also listen for mousedown for better coverage
              button.addEventListener('mousedown', () => {
                setTimeout(captureGoogleFormSubmission, 500);
              }, true);
            }
          });
        } catch (err) {
          // Some selectors might fail, ignore
        }
      });
    }

    const observer = new MutationObserver(() => {
      attachListeners();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'jsname', 'role']
    });

    // Check immediately and repeatedly
    attachListeners();
    
    // Check periodically for new buttons
    setInterval(() => {
      if (isGoogleForm()) {
        attachListeners();
      }
    }, 1000);
  }

  /**
   * Extract data from Microsoft Forms
   */
  function extractMicrosoftFormData() {
    const formData = {};
    
    try {
      // Microsoft Forms uses React components with specific class names
      // Try multiple selectors for form fields
      const selectors = [
        'input[type="text"]',
        'input[type="email"]',
        'input[type="number"]',
        'input[type="date"]',
        'input[type="time"]',
        'input[type="tel"]',
        'textarea',
        'select',
        '[role="textbox"]',
        '[role="combobox"]',
        '.office-form-question-element',
        '[data-automation-id]'
      ];

      // Find all form elements
      const inputs = document.querySelectorAll('input, textarea, select, [role="textbox"], [role="combobox"]');
      
      inputs.forEach((element, index) => {
        try {
          let fieldName = null;
          let fieldValue = null;
          let questionText = null;

          // Try to get question text (label)
          // Microsoft Forms uses various structures
          const questionContainer = element.closest('[data-automation-id], .office-form-question-element, [class*="QuestionContainer"]');
          const label = questionContainer?.querySelector('label, [role="heading"], [class*="QuestionTitle"], [class*="questionTitle"]');
          questionText = label?.textContent?.trim() || 
                        element.getAttribute('aria-label') || 
                        element.getAttribute('placeholder') ||
                        `Question ${index + 1}`;

          // Handle different input types
          if (element.type === 'text' || element.type === 'email' || element.type === 'number' || 
              element.type === 'date' || element.type === 'time' || element.type === 'tel') {
            fieldName = element.getAttribute('name') || element.getAttribute('data-automation-id') || questionText;
            fieldValue = element.value;
          } else if (element.type === 'checkbox' || element.type === 'radio') {
            if (element.checked) {
              fieldName = element.getAttribute('name') || questionText;
              fieldValue = element.value || element.getAttribute('aria-label') || 'selected';
              
              // Group radio buttons and checkboxes by question
              if (!formData[fieldName]) {
                formData[fieldName] = [];
              }
              if (Array.isArray(formData[fieldName])) {
                formData[fieldName].push(fieldValue);
              } else {
                formData[fieldName] = [formData[fieldName], fieldValue];
              }
              return;
            }
          } else if (element.tagName === 'TEXTAREA' || element.getAttribute('role') === 'textbox') {
            fieldName = element.getAttribute('name') || element.getAttribute('data-automation-id') || questionText;
            fieldValue = element.value || element.textContent;
          } else if (element.tagName === 'SELECT' || element.getAttribute('role') === 'combobox') {
            fieldName = element.getAttribute('name') || element.getAttribute('data-automation-id') || questionText;
            fieldValue = element.value;
          }

          // Only store if we have a name and value
          if (fieldName && fieldValue !== null && fieldValue !== '') {
            const key = questionText !== `Question ${index + 1}` ? questionText : fieldName;
            
            if (!formData[key]) {
              formData[key] = fieldValue;
            } else if (Array.isArray(formData[key])) {
              formData[key].push(fieldValue);
            } else {
              formData[key] = [formData[key], fieldValue];
            }
          }
        } catch (err) {
          // Skip this element
        }
      });

      // Try to extract from Microsoft Forms' internal state
      try {
        // Microsoft Forms may store data in window or React state
        if (window.__MSF_DATACONTEXT) {
          const dataContext = window.__MSF_DATACONTEXT;
          if (dataContext && dataContext.responseData) {
            Object.assign(formData, dataContext.responseData);
          }
        }
      } catch (e) {
        // Ignore
      }

      return formData;
    } catch (err) {
      console.debug('FormTrack: Error extracting Microsoft Form data', err);
      return {};
    }
  }

  /**
   * Capture Microsoft Form submission
   */
  function captureMicrosoftFormSubmission() {
    if (!isMicrosoftForm()) return;
    
    const formData = extractMicrosoftFormData();
    
    if (Object.keys(formData).length === 0) {
      return;
    }

    const submission = {
      url: window.location.href,
      action: window.location.href,
      timestamp: new Date().toISOString(),
      fields: formData,
      title: document.title || 'Microsoft Form',
      source: 'microsoft-forms'
    };

    safeSendMessage({
      type: 'FORM_SUBMISSION',
      data: submission
    });
  }

  /**
   * Monitor Microsoft Forms submit button
   */
  function setupMicrosoftFormMonitoring() {
    if (!isMicrosoftForm()) return;

    // Watch for submit button clicks
    const submitButtonSelectors = [
      'button[type="submit"]',
      '[data-automation-id*="submit"]',
      '[data-automation-id*="Submit"]',
      '[aria-label*="Submit"], [aria-label*="submit"]',
      '[class*="submitButton"]',
      '[class*="SubmitButton"]',
      'button[class*="ms-Button"]',
      '[role="button"][aria-label*="Submit"]'
    ];

    const observer = new MutationObserver(() => {
      submitButtonSelectors.forEach(selector => {
        const buttons = document.querySelectorAll(selector);
        buttons.forEach(button => {
          if (!button.dataset.formtrackWatched) {
            button.dataset.formtrackWatched = 'true';
            button.addEventListener('click', () => {
              // Wait a bit for form data to be ready
              setTimeout(captureMicrosoftFormSubmission, 500);
            }, true);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also check immediately
    submitButtonSelectors.forEach(selector => {
      const buttons = document.querySelectorAll(selector);
      buttons.forEach(button => {
        if (!button.dataset.formtrackWatched) {
          button.dataset.formtrackWatched = 'true';
          button.addEventListener('click', () => {
            setTimeout(captureMicrosoftFormSubmission, 500);
          }, true);
        }
      });
    });
  }

  /**
   * Extract data from ClickUp Forms
   */
  function extractClickUpFormData() {
    const formData = {};
    
    try {
      // ClickUp Forms uses React components with various structures
      // Try multiple selectors for form fields
      const selectors = [
        'input[type="text"]',
        'input[type="email"]',
        'input[type="number"]',
        'input[type="tel"]',
        'input[type="date"]',
        'input[type="time"]',
        'input[type="url"]',
        'textarea',
        'select',
        '[role="textbox"]',
        '[role="combobox"]',
        '[data-testid]',
        '[class*="field"]',
        '[class*="input"]',
        '[class*="question"]'
      ];

      // Find all form elements
      const inputs = document.querySelectorAll('input, textarea, select, [role="textbox"], [role="combobox"]');
      
      inputs.forEach((element, index) => {
        try {
          let fieldName = null;
          let fieldValue = null;
          let questionText = null;

          // Try to get question text (label) - ClickUp Forms uses various structures
          const fieldContainer = element.closest('[class*="field"], [class*="question"], [class*="form-field"], [data-testid]');
          const label = fieldContainer?.querySelector('label, [role="heading"], [class*="label"], [class*="title"], [class*="question-title"]') ||
                       element.previousElementSibling?.tagName === 'LABEL' ? element.previousElementSibling :
                       element.closest('label')?.previousElementSibling;
          
          questionText = label?.textContent?.trim() || 
                        element.getAttribute('aria-label') || 
                        element.getAttribute('placeholder') ||
                        element.getAttribute('name') ||
                        element.getAttribute('data-testid') ||
                        `Field ${index + 1}`;

          // Handle different input types
          if (element.type === 'text' || element.type === 'email' || element.type === 'number' || 
              element.type === 'tel' || element.type === 'date' || element.type === 'time' || element.type === 'url') {
            fieldName = element.getAttribute('name') || element.getAttribute('data-testid') || questionText;
            fieldValue = element.value;
          } else if (element.type === 'checkbox' || element.type === 'radio') {
            if (element.checked) {
              fieldName = element.getAttribute('name') || questionText;
              fieldValue = element.value || element.getAttribute('aria-label') || element.nextElementSibling?.textContent?.trim() || 'selected';
              
              // Group radio buttons and checkboxes by question
              if (!formData[fieldName]) {
                formData[fieldName] = [];
              }
              if (Array.isArray(formData[fieldName])) {
                formData[fieldName].push(fieldValue);
              } else {
                formData[fieldName] = [formData[fieldName], fieldValue];
              }
              return;
            }
          } else if (element.tagName === 'TEXTAREA' || element.getAttribute('role') === 'textbox') {
            fieldName = element.getAttribute('name') || element.getAttribute('data-testid') || questionText;
            fieldValue = element.value || element.textContent;
          } else if (element.tagName === 'SELECT' || element.getAttribute('role') === 'combobox') {
            fieldName = element.getAttribute('name') || element.getAttribute('data-testid') || questionText;
            fieldValue = element.value;
          }

          // Only store if we have a name and value
          if (fieldName && fieldValue !== null && fieldValue !== '') {
            const key = questionText !== `Field ${index + 1}` ? questionText : fieldName;
            
            if (!formData[key]) {
              formData[key] = fieldValue;
            } else if (Array.isArray(formData[key])) {
              formData[key].push(fieldValue);
            } else {
              formData[key] = [formData[key], fieldValue];
            }
          }
        } catch (err) {
          // Skip this element
        }
      });

      // Try to extract from ClickUp Forms' internal state
      try {
        // ClickUp Forms may store data in window or React state
        if (window.__CLICKUP_FORM_DATA) {
          const clickUpData = window.__CLICKUP_FORM_DATA;
          if (clickUpData && clickUpData.formData) {
            Object.assign(formData, clickUpData.formData);
          }
        }
      } catch (e) {
        // Ignore
      }

      return formData;
    } catch (err) {
      console.debug('FormTrack: Error extracting ClickUp Form data', err);
      return {};
    }
  }

  /**
   * Capture ClickUp Form submission
   */
  function captureClickUpFormSubmission() {
    if (!isClickUpForm()) return;
    
    // Try multiple times with delays to capture data
    let attempts = 0;
    const maxAttempts = 3;
    
    function attemptCapture() {
      attempts++;
      const formData = extractClickUpFormData();
      
      if (Object.keys(formData).length === 0 && attempts < maxAttempts) {
        // Retry after a short delay
        setTimeout(attemptCapture, 300);
        return;
      }
      
      // If still no data after attempts, try to capture from form inputs directly
      if (Object.keys(formData).length === 0) {
        // Last resort: capture visible form inputs
        const allInputs = document.querySelectorAll('input[value]:not([type="submit"]):not([type="button"]), textarea[value], select option:checked');
        allInputs.forEach(input => {
          const value = input.value || input.textContent;
          const name = input.getAttribute('name') || 
                      input.getAttribute('data-testid') || 
                      input.getAttribute('aria-label') || 
                      input.closest('[class*="field"]')?.querySelector('[class*="label"]')?.textContent ||
                      `Field_${Object.keys(formData).length + 1}`;
          if (value && value.trim()) {
            formData[name] = value;
          }
        });
      }
      
      if (Object.keys(formData).length === 0) {
        console.debug('FormTrack: No ClickUp Form data captured');
        return;
      }

      const submission = {
        url: window.location.href,
        action: window.location.href,
        timestamp: new Date().toISOString(),
        fields: formData,
        title: document.title || 'ClickUp Form',
        source: 'clickup-forms'
      };

      safeSendMessage({
        type: 'FORM_SUBMISSION',
        data: submission
      });
    }
    
    attemptCapture();
  }

  /**
   * Monitor ClickUp Forms submit button
   */
  function setupClickUpFormMonitoring() {
    if (!isClickUpForm()) return;

    // Watch for submit button clicks - expanded selectors for ClickUp Forms
    const submitButtonSelectors = [
      'button[type="submit"]',
      '[data-testid*="submit"]',
      '[data-testid*="Submit"]',
      '[class*="submit"]',
      '[class*="Submit"]',
      '[aria-label*="Submit"], [aria-label*="submit"]',
      '[role="button"][aria-label*="Submit"]',
      'button[class*="button"]:not([type="button"])',
      '[class*="submit-button"]',
      '[class*="submitButton"]'
    ];

    function attachListeners() {
      submitButtonSelectors.forEach(selector => {
        try {
          const buttons = document.querySelectorAll(selector);
          buttons.forEach(button => {
            // Check if button text indicates submit action
            const buttonText = button.textContent?.toLowerCase() || '';
            const isSubmitButton = buttonText.includes('submit') || 
                                   buttonText.includes('send') ||
                                   button.type === 'submit' ||
                                   button.getAttribute('aria-label')?.toLowerCase().includes('submit');
            
            if (isSubmitButton && !button.dataset.formtrackWatched) {
              button.dataset.formtrackWatched = 'true';
              // Use capture phase to intercept early
              button.addEventListener('click', (e) => {
                console.debug('FormTrack: ClickUp Form submit button clicked');
                // Capture immediately and also after delay
                setTimeout(captureClickUpFormSubmission, 100);
                setTimeout(captureClickUpFormSubmission, 500);
                setTimeout(captureClickUpFormSubmission, 1000);
              }, true);
              
              // Also listen for mousedown for better coverage
              button.addEventListener('mousedown', () => {
                setTimeout(captureClickUpFormSubmission, 300);
              }, true);
            }
          });
        } catch (err) {
          // Some selectors might fail, ignore
        }
      });
    }

    const observer = new MutationObserver(() => {
      attachListeners();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-testid', 'role', 'aria-label']
    });

    // Check immediately and repeatedly
    attachListeners();
    
    // Check periodically for new buttons
    setInterval(() => {
      if (isClickUpForm()) {
        attachListeners();
      }
    }, 1000);
  }

  /**
   * Handle programmatic form submissions (AJAX, fetch, etc.)
   */
  function interceptFetch() {
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const [url, options] = args;
      
      // Check if this looks like a form submission
      if (options && options.method && 
          (options.method.toUpperCase() === 'POST' || options.method.toUpperCase() === 'PUT') &&
          options.body) {
        
        try {
          // Special handling for Google Forms, Microsoft Forms, and ClickUp Forms
          const urlStr = typeof url === 'string' ? url : url.toString();
          const isGoogleFormsEndpoint = urlStr.includes('forms/d/e/') || 
                                        urlStr.includes('forms/u/0/d/e/') ||
                                        urlStr.includes('/formResponse');
          const isMicrosoftFormsEndpoint = urlStr.includes('forms.office.com') ||
                                          urlStr.includes('forms.microsoft.com') ||
                                          urlStr.includes('forms.office365.com') ||
                                          urlStr.includes('/api/form/') ||
                                          urlStr.includes('/api/Response') ||
                                          urlStr.includes('/SubmitForm');
          const isClickUpFormsEndpoint = urlStr.includes('forms.clickup.com') ||
                                        urlStr.includes('/api/form/') ||
                                        urlStr.includes('/form/submit') ||
                                        urlStr.includes('/submit-form');

          if (isGoogleFormsEndpoint) {
            // Capture Google Form submission with multiple attempts
            console.debug('FormTrack: Google Forms endpoint detected');
            setTimeout(() => {
              captureGoogleFormSubmission();
            }, 200);
            setTimeout(() => {
              captureGoogleFormSubmission();
            }, 800);
            setTimeout(() => {
              captureGoogleFormSubmission();
            }, 1500);
          }

          if (isMicrosoftFormsEndpoint) {
            // Capture Microsoft Form submission
            setTimeout(() => {
              captureMicrosoftFormSubmission();
            }, 300);
          }

          if (isClickUpFormsEndpoint) {
            // Capture ClickUp Form submission
            console.debug('FormTrack: ClickUp Forms endpoint detected');
            setTimeout(() => {
              captureClickUpFormSubmission();
            }, 200);
            setTimeout(() => {
              captureClickUpFormSubmission();
            }, 800);
            setTimeout(() => {
              captureClickUpFormSubmission();
            }, 1500);
          }

          // Try to parse body as form data or JSON
          let formData = {};
          
          if (options.body instanceof FormData) {
            options.body.forEach((value, key) => {
              // Skip passwords
              if (key.toLowerCase().includes('password')) return;
              formData[key] = value;
            });
          } else if (typeof options.body === 'string') {
            try {
              const parsed = JSON.parse(options.body);
              
              // For Google Forms, extract meaningful data
              if (isGoogleFormsEndpoint) {
                // Google Forms sends data in a specific format
                if (parsed['entry.'] || parsed['entry']) {
                  Object.keys(parsed).forEach(key => {
                    if (key.startsWith('entry.') || key.startsWith('entry_')) {
                      const cleanKey = key.replace(/^entry\.?/, '');
                      formData[cleanKey] = parsed[key];
                    } else if (!key.toLowerCase().includes('password')) {
                      formData[key] = parsed[key];
                    }
                  });
                } else {
                  Object.keys(parsed).forEach(key => {
                    if (!key.toLowerCase().includes('password')) {
                      formData[key] = parsed[key];
                    }
                  });
                }
              } else {
                Object.keys(parsed).forEach(key => {
                  if (!key.toLowerCase().includes('password')) {
                    formData[key] = parsed[key];
                  }
                });
              }
            } catch (e) {
              // Not JSON, might be URL-encoded
              const params = new URLSearchParams(options.body);
              params.forEach((value, key) => {
                if (!key.toLowerCase().includes('password')) {
                  // For Google Forms entry format
                  if (key.startsWith('entry.')) {
                    const cleanKey = key.replace(/^entry\./, '');
                    formData[cleanKey] = value;
                  } else {
                    formData[key] = value;
                  }
                }
              });
            }
          }
          
          if (Object.keys(formData).length > 0) {
            const submission = {
              url: urlStr,
              action: urlStr,
              timestamp: new Date().toISOString(),
              fields: formData,
              title: document.title || 'Untitled Page',
              source: isGoogleFormsEndpoint ? 'google-forms' : 
                      (isMicrosoftFormsEndpoint ? 'microsoft-forms' : 
                      (isClickUpFormsEndpoint ? 'clickup-forms' : 'fetch'))
            };
            
            safeSendMessage({
              type: 'FORM_SUBMISSION',
              data: submission
            });
          }
        } catch (err) {
          // Silently fail
        }
      }
      
      return originalFetch.apply(this, args);
    };
  }

  /**
   * Intercept XMLHttpRequest for Google Forms, Microsoft Forms, and ClickUp Forms
   */
  function interceptXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this._formtrackUrl = url;
      this._formtrackMethod = method;
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(data) {
      if (this._formtrackMethod && 
          (this._formtrackMethod.toUpperCase() === 'POST' || this._formtrackMethod.toUpperCase() === 'PUT') &&
          this._formtrackUrl) {
        
        const urlStr = this._formtrackUrl.toString();
        const isGoogleFormsEndpoint = urlStr.includes('forms/d/e/') || 
                                      urlStr.includes('forms/u/0/d/e/') ||
                                      urlStr.includes('/formResponse');
        const isMicrosoftFormsEndpoint = urlStr.includes('forms.office.com') ||
                                        urlStr.includes('forms.microsoft.com') ||
                                        urlStr.includes('forms.office365.com') ||
                                        urlStr.includes('/api/form/') ||
                                        urlStr.includes('/api/Response') ||
                                        urlStr.includes('/SubmitForm');
        const isClickUpFormsEndpoint = urlStr.includes('forms.clickup.com') ||
                                      urlStr.includes('/api/form/') ||
                                      urlStr.includes('/form/submit') ||
                                      urlStr.includes('/submit-form');

        if ((isGoogleFormsEndpoint || isMicrosoftFormsEndpoint || isClickUpFormsEndpoint) && data) {
          try {
            let formData = {};
            
            if (data instanceof FormData) {
              data.forEach((value, key) => {
                if (!key.toLowerCase().includes('password')) {
                  formData[key] = value;
                }
              });
            } else if (typeof data === 'string') {
              try {
                const parsed = JSON.parse(data);
                Object.keys(parsed).forEach(key => {
                  if (key.startsWith('entry.') || key.startsWith('entry_')) {
                    const cleanKey = key.replace(/^entry\.?/, '');
                    formData[cleanKey] = parsed[key];
                  } else if (!key.toLowerCase().includes('password')) {
                    formData[key] = parsed[key];
                  }
                });
              } catch (e) {
                const params = new URLSearchParams(data);
                params.forEach((value, key) => {
                  if (!key.toLowerCase().includes('password')) {
                    if (key.startsWith('entry.')) {
                      const cleanKey = key.replace(/^entry\./, '');
                      formData[cleanKey] = value;
                    } else {
                      formData[key] = value;
                    }
                  }
                });
              }
            }

            if (Object.keys(formData).length > 0) {
              setTimeout(() => {
                const submission = {
                  url: window.location.href,
                  action: urlStr,
                  timestamp: new Date().toISOString(),
                  fields: formData,
                  title: document.title || (isMicrosoftFormsEndpoint ? 'Microsoft Form' : (isClickUpFormsEndpoint ? 'ClickUp Form' : 'Google Form')),
                  source: isMicrosoftFormsEndpoint ? 'microsoft-forms' : (isClickUpFormsEndpoint ? 'clickup-forms' : 'google-forms')
                };

                safeSendMessage({
                  type: 'FORM_SUBMISSION',
                  data: submission
                });
              }, 200);
            }

            // Also trigger DOM-based capture for better coverage
            if (isMicrosoftFormsEndpoint) {
              setTimeout(() => {
                captureMicrosoftFormSubmission();
              }, 300);
            }

            if (isClickUpFormsEndpoint) {
              setTimeout(() => {
                captureClickUpFormSubmission();
              }, 300);
            }
          } catch (err) {
            // Silently fail
          }
        }
      }

      return originalSend.apply(this, [data]);
    };
  }

  // Initialize
  function init() {
    // Listen for form submit events
    document.addEventListener('submit', captureFormSubmission, true);
    
    // Intercept fetch for AJAX submissions
    if (window.fetch) {
      interceptFetch();
    }

    // Intercept XHR for Google Forms and other AJAX submissions
    if (window.XMLHttpRequest) {
      interceptXHR();
    }

    // Setup Google Forms specific monitoring
    if (isGoogleForm()) {
      setupGoogleFormMonitoring();
      
      // Also try to capture immediately if form is already loaded
      setTimeout(() => {
        setupGoogleFormMonitoring();
      }, 1000);
    }

    // Setup Microsoft Forms specific monitoring
    if (isMicrosoftForm()) {
      setupMicrosoftFormMonitoring();
      
      // Also try to capture immediately if form is already loaded
      setTimeout(() => {
        setupMicrosoftFormMonitoring();
      }, 1000);
    }

    // Setup ClickUp Forms specific monitoring
    if (isClickUpForm()) {
      setupClickUpFormMonitoring();
      
      // Also try to capture immediately if form is already loaded
      setTimeout(() => {
        setupClickUpFormMonitoring();
      }, 1000);
    }

    // Re-check for Google Forms, Microsoft Forms, and ClickUp Forms periodically (for dynamically loaded content)
    if (window.location.hostname.includes('docs.google.com') || 
        window.location.hostname.includes('forms.office.com') ||
        window.location.hostname.includes('forms.microsoft.com') ||
        window.location.hostname.includes('forms.office365.com') ||
        window.location.hostname.includes('forms.clickup.com')) {
      setInterval(() => {
        if (isGoogleForm() && document.querySelector('[role="button"][aria-label*="Submit"]')) {
          setupGoogleFormMonitoring();
        }
        if (isMicrosoftForm() && document.querySelector('[role="button"][aria-label*="Submit"], button[type="submit"]')) {
          setupMicrosoftFormMonitoring();
        }
        if (isClickUpForm() && document.querySelector('button[type="submit"], [role="button"][aria-label*="Submit"], button[class*="submit"]')) {
          setupClickUpFormMonitoring();
        }
      }, 2000);
    }
    
    const detected = [];
    if (isGoogleForm()) detected.push('Google Forms');
    if (isMicrosoftForm()) detected.push('Microsoft Forms');
    if (isClickUpForm()) detected.push('ClickUp Forms');
    console.log('FormTrack: Content script loaded', detected.length > 0 ? `(${detected.join(', ')} detected)` : '');
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

