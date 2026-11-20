# BulkSMSBD API Integration Master Plan

## 1. Project Overview
This document outlines the implementation plan for integrating the **BulkSMSBD** SMS gateway into the Rawgadz web application. The integration handles two primary features:
1. **Automatic Payment Verification / Order Confirmation SMS:** Triggered automatically when a customer places a COD order via `/api/checkout`.
2. **Admin Panel Manual SMS:** A UI feature in `/admin` (`admin.html` & `order.html`) allowing admins to send custom SMS messages to specific customers via a modal popup next to the Pathao dispatch action.

## 2. Technical Stack & Constraints
- **Backend:** Vercel Serverless Functions using pure Node.js (`api/checkout.js`, `api/admin-send-sms.js`, and `lib/smsHelper.js`).
- **Frontend:** HTML, Tailwind CSS, and JavaScript (Alpine.js controller in `admin.html` & `order.html`).
- **Security:** `BULKSMSBD_API_KEY` and `BULKSMSBD_SENDER_ID` are strictly stored in Vercel Environment Variables (`process.env.BULKSMSBD_API_KEY` and `process.env.BULKSMSBD_SENDER_ID`) and never exposed to client-side code.

---

## 3. BulkSMSBD API Reference

### 3.1 Single SMS API (One to Many)
- **Endpoint:** `https://bulksmsbd.net/api/smsapi` (POST)
- **JSON Payload Format:**
```json
{
  "api_key": "{your_api_key}",
  "senderid": "{sender_id}",
  "number": "88016xxxxxxxx,88019xxxxxxxx",
  "message": "{your_test_sms_content}"
}
```

### 3.2 Many SMS API (Many to Many)
- **Endpoint:** `https://bulksmsbd.net/api/smsapimany` (POST)
- **JSON Payload Format:**
```json
{
  "api_key": "{your_api_key}",
  "senderid": "{sender_id}",
  "messages": [
    {
      "to": "88016xxxxxxxx",
      "message": "test sms content..."
    },
    {
      "to": "88019xxxxxxxx",
      "message": "test sms content..."
    }
  ]
}
```

### 3.3 API Response Codes (Error & Success)
| Code | Meaning | Action Required |
| :--- | :--- | :--- |
| **202** | SMS Submitted Successfully | Success state. |
| 1002 | sender id not correct/disabled | Check Sender ID in dashboard. |
| 1003 | Required fields missing | Check payload structure. |
| 1005 | Internal Error | Retry or log error. |
| 1006 | Balance Validity Not Available | Check account validity. |
| 1007 | Balance Insufficient | Alert admin to top up. |
| 1011 | User Id not found | Check API Key. |
| 1012 | Masking SMS must be sent in Bengali | Change message language. |
| 1031 | Account Not Verified | Contact BulkSMSBD support. |
| 1032 | IP Not whitelisted | Add Vercel IP to BulkSMSBD dashboard. |

---

## 4. Environment Configuration
Add the following Environment Variables to the Vercel Dashboard (**Settings > Environment Variables**):

| Variable Name | Value | Environment |
| :--- | :--- | :--- |
| `BULKSMSBD_API_KEY` | Your actual API Key from BulkSMSBD | Production, Preview, Development |
| `BULKSMSBD_SENDER_ID` | Your approved Sender ID (e.g., 88096176XXXXX) | Production, Preview, Development |
