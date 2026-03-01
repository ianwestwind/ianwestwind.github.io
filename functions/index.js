// ============================================================
// WINN Platforms — Cloud Functions
// Sends approval/rejection emails when a consultation booking
// status changes to "approved" or "rejected".
//
// Setup:
//   firebase functions:secrets:set RESEND_API_KEY
//   cd functions && npm install
//   firebase deploy --only functions
//
// After Resend domain verification, update the `from` field below.
// ============================================================

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret }      = require("firebase-functions/params");
const { initializeApp }     = require("firebase-admin/app");
const { getFirestore }      = require("firebase-admin/firestore");

initializeApp();

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

// ---- Helpers ----

function _formatDate(ts) {
  let d;
  if (ts && typeof ts.toDate === "function") d = ts.toDate();
  else if (ts && typeof ts.seconds === "number") d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  return d.toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

function _buildGoogleCalUrl(ts, durationMins, videoLink) {
  let start;
  if (ts && typeof ts.toDate === "function") start = ts.toDate();
  else if (ts && typeof ts.seconds === "number") start = new Date(ts.seconds * 1000);
  else start = new Date(ts);
  const end = new Date(start.getTime() + (durationMins || 30) * 60000);
  const fmt = d => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const params = new URLSearchParams({
    action:   "TEMPLATE",
    text:     "Consultation - WINN Platforms",
    dates:    `${fmt(start)}/${fmt(end)}`,
    details:  `Join at: ${videoLink}`,
    location: videoLink,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ---- Firestore trigger ----

exports.onConsultationStatusChange = onDocumentUpdated(
  {
    document: "consultations/{bookingId}",
    secrets:  [RESEND_API_KEY],
  },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();

    // Only fire when status actually changes to approved or rejected
    if (before.status === after.status) return null;
    if (after.status !== "approved" && after.status !== "rejected") return null;

    const recipientEmail = after.requesterEmail || null;
    if (!recipientEmail) {
      console.warn("No requester email for booking:", event.params.bookingId);
      return null;
    }

    const db = getFirestore();

    // Fetch admin-configured email settings
    let settings = { approvalMessage: "", videoLink: "" };
    try {
      const snap = await db.doc("site_config/consultation_settings").get();
      if (snap.exists) settings = { ...settings, ...snap.data() };
    } catch (err) {
      console.error("Failed to fetch consultation_settings:", err);
    }

    const recipientName = after.requesterName || "there";
    const dateLabel     = _formatDate(after.slotDateTime);
    const durationMins  = after.durationMins || 30;
    const videoLink     = settings.videoLink || "";

    let subject, htmlBody;

    if (after.status === "approved") {
      const approvalMessage = settings.approvalMessage ||
        "Your consultation has been confirmed. Please join using the meeting link below at your scheduled time.";
      const gcalUrl = videoLink
        ? _buildGoogleCalUrl(after.slotDateTime, durationMins, videoLink)
        : "";

      subject  = "Your Consultation is Confirmed — WINN Platforms";
      htmlBody = `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h2 style="margin-bottom:4px">Consultation Confirmed ✓</h2>
          <p style="color:#666;margin-top:0;font-size:14px">WINN Platforms</p>
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0"/>
          <p>Hi ${recipientName},</p>
          <p>${approvalMessage}</p>
          <p style="margin:12px 0">
            <strong>Date &amp; Time:</strong><br/>
            ${dateLabel}
          </p>
          ${videoLink ? `
          <p style="margin:12px 0">
            <strong>Meeting Link:</strong><br/>
            <a href="${videoLink}" style="color:#333">${videoLink}</a>
          </p>` : ""}
          ${gcalUrl ? `
          <p style="margin:16px 0">
            <a href="${gcalUrl}"
               style="display:inline-block;background:#111;color:#fff;
                      padding:10px 18px;text-decoration:none;font-size:14px;
                      font-weight:600">
              Add to Google Calendar
            </a>
          </p>` : ""}
          <hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px"/>
          <p style="font-size:12px;color:#999">WINN Platforms</p>
        </div>`;
    } else {
      subject  = "Consultation Request Update — WINN Platforms";
      htmlBody = `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h2 style="margin-bottom:4px">Consultation Request Update</h2>
          <p style="color:#666;margin-top:0;font-size:14px">WINN Platforms</p>
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0"/>
          <p>Hi ${recipientName},</p>
          <p>Thank you for your interest in a consultation. Unfortunately, we are unable to
             accommodate your request for <strong>${dateLabel}</strong>.</p>
          <p>Please visit the site to browse other available time slots and submit a new request.</p>
          <hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px"/>
          <p style="font-size:12px;color:#999">WINN Platforms</p>
        </div>`;
    }

    // Send via Resend REST API (Node 18 global fetch)
    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY.value()}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        // Update `from` to a verified domain address after Resend domain setup.
        // Until then, only delivers to the email tied to your Resend account.
        from:    "WINN Platforms <onboarding@resend.dev>",
        to:      [recipientEmail],
        subject,
        html:    htmlBody,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend API error:", res.status, errText);
      throw new Error(`Resend failed with status ${res.status}`);
    }

    const json = await res.json();
    console.log("Email sent:", json.id, "→", recipientEmail);
    return null;
  }
);
