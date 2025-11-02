# FormTrack - Chrome Extension

Track and remember what you've submitted in online forms. All data stored locally for privacy.

## 📋 Features

- ✅ **Automatic Form Capture** - Automatically captures form submissions as you browse
- 📝 **Google Forms Compatible** - Special support for Google Forms with enhanced detection
- 📝 **Microsoft Forms Compatible** - Special support for Microsoft Forms (Office 365) with enhanced detection
- 📧 **Email Notifications** - Optional email notifications via Resend API when forms are submitted
- 🔒 **Privacy First** - All data stored locally, never sent to external servers (email is optional)
- 🔍 **Search & Filter** - Quickly find past submissions by URL, title, or field content
- 📤 **Export as JSON** - Export your entire submission history
- 🚫 **Smart Ignore** - Automatically skips sensitive forms (login, banking, etc.)
- 📊 **Submission Count** - Badge shows number of tracked submissions
- ⚡ **Fast & Lightweight** - Minimal performance impact

## 🚀 Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked"
5. Select the `formtracker` folder
6. The FormTrack icon should appear in your toolbar

## 📖 Usage

1. **Automatic Tracking**: Once installed, FormTrack automatically captures form submissions on all websites
2. **Google Forms**: Special support for Google Forms - fill out any Google Form and submit, it will be automatically captured
3. **Microsoft Forms**: Special support for Microsoft Forms (Office 365) - fill out any Microsoft Form and submit, it will be automatically captured
4. **Email Notifications (Optional)**: Click the ⚙️ settings button to configure Resend API for email notifications
   - Get your API key from [resend.com/api-keys](https://resend.com/api-keys)
   - Configure recipient email address
   - Enable automatic email notifications on form submissions
5. **View History**: Click the FormTrack icon in your toolbar to view all captured submissions
6. **Search**: Use the search box to filter submissions by URL, title, or field content
7. **Export**: Click "Export" to download all submissions as a JSON file
8. **Clear**: Click "Clear" to delete all stored submissions

## 🛠️ Technical Details

### Architecture

- **manifest.json** - Chrome extension manifest (Manifest V3)
- **content.js** - Captures form submissions on web pages
- **background.js** - Service worker that handles storage and message passing
- **popup.html/js/css** - User interface for viewing and managing submissions

### Storage

- Uses `chrome.storage.local` API
- Maximum of 200 submissions stored (oldest removed automatically)
- Each submission includes:
  - URL and page title
  - Timestamp
  - All form fields (passwords excluded)
  - Form action URL

### Privacy

- All data stored locally in your browser
- Passwords are never captured
- Sensitive forms (login, banking) are automatically ignored
- No data transmitted to external servers

## 🎯 Roadmap

- [ ] Custom ignore list configuration
- [ ] Form restore functionality
- [ ] Cloud sync (optional, user-controlled)
- [ ] Analytics dashboard
- [ ] Smart categorization and tags
- [ ] Dark mode support

## 📝 License

MIT License - Feel free to use, modify, and distribute

## 🤝 Contributing

Contributions welcome! Please feel free to submit issues or pull requests.
