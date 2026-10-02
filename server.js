require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const { GoogleGenAI, Type } = require('@google/genai');
const { createClient } = require('@supabase/supabase-js');

const app = express();

const PORT = 5000;

// ========================================
// Environment variables
// ========================================

if (!process.env.GEMINI_API_KEY) {
  console.error(
    'ERROR: GEMINI_API_KEY is missing from .env'
  );

  process.exit(1);
}

if (!process.env.SUPABASE_URL) {
  console.error(
    'ERROR: SUPABASE_URL is missing from .env'
  );

  process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'ERROR: SUPABASE_SERVICE_ROLE_KEY is missing from .env'
  );

  process.exit(1);
}

// ========================================
// Gemini
// ========================================

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ========================================
// Supabase SERVER client
// ========================================
//
// IMPORTANT:
// This client uses the service-role key.
// NEVER put this key in the Expo app.
//

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// ========================================
// Express
// ========================================

app.use(cors());

app.use(express.json());

// ========================================
// Multer
// ========================================
//
// memoryStorage means the image stays in RAM.
// It is NOT written to the backend disk.
//

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

// ========================================
// Allowed image types
// ========================================

const allowedImageTypes = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

// ========================================
// Health
// ========================================

app.get('/', (req, res) => {
  res.json({
    message: 'Civik Backend is running!',
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Civik API is healthy',
  });
});

// ========================================
// GEMINI IMAGE VALIDATION
// ========================================

app.post(
  '/api/image/validate',
  upload.single('image'),

  async (req, res) => {
    try {
      console.log('');
      console.log('--------------------------------');
      console.log(
        'Image validation request received'
      );
      console.log('--------------------------------');

      if (!req.file) {
        return res.status(400).json({
          success: false,
          valid: false,
          message: 'No image was uploaded.',
        });
      }

      console.log(
        'File name:',
        req.file.originalname
      );

      console.log(
        'File type:',
        req.file.mimetype
      );

      console.log(
        'File size:',
        req.file.size,
        'bytes'
      );

      if (
        !allowedImageTypes.includes(
          req.file.mimetype
        )
      ) {
        return res.status(400).json({
          success: false,
          valid: false,
          message:
            'Unsupported image format.',
        });
      }

      const base64Image =
        req.file.buffer.toString('base64');

      const prompt = `
You are the image validation system for Civik,
a civic issue reporting application.

Determine whether the uploaded photograph shows
a REAL, VISIBLE, and REPORTABLE civic issue.

Possible civic issues include:

- Garbage or accumulated waste
- Illegal dumping
- Potholes
- Broken or severely damaged roads
- Waterlogging or flooding on public roads
- Open manholes
- Damaged or missing manhole covers
- Broken footpaths or sidewalks
- Damaged curbs
- Broken streetlights
- Fallen trees obstructing public roads
- Damaged traffic signs
- Damaged public infrastructure
- Overflowing drains
- Sewage or drainage problems
- Construction debris blocking public areas
- Other clearly visible public/civic issue

Reject:

- Normal streets
- Clean streets
- Ordinary buildings
- Private property problems
- Cars or motorcycles by themselves
- People or selfies
- Animals
- Food
- Nature scenes
- Ordinary construction
- Screenshots
- Memes
- Drawings
- Products
- Images where the issue cannot clearly be seen
- Images with insufficient visual evidence

Judge ONLY what can reasonably be observed.

Do not invent details.

If uncertain, reject the image.

Return ONLY structured JSON.
`;

      console.log(
        'Sending image to Gemini...'
      );

      const response =
        await ai.models.generateContent({
          model: 'gemini-3-flash-preview',

          contents: [
            {
              inlineData: {
                mimeType:
                  req.file.mimetype,

                data: base64Image,
              },
            },

            {
              text: prompt,
            },
          ],

          config: {
            thinkingConfig: {
              thinkingLevel: 'minimal',
            },

            responseMimeType:
              'application/json',

            responseSchema: {
              type: Type.OBJECT,

              properties: {
                isCivicIssue: {
                  type: Type.BOOLEAN,
                },

                issueType: {
                  type: Type.STRING,
                },

                confidence: {
                  type: Type.NUMBER,
                },

                severity: {
                  type: Type.STRING,
                },

                reason: {
                  type: Type.STRING,
                },
              },

              required: [
                'isCivicIssue',
                'issueType',
                'confidence',
                'severity',
                'reason',
              ],
            },
          },
        });

      console.log(
        'Gemini response received.'
      );

      const rawText = response.text;

      console.log(
        'Gemini raw response:',
        rawText
      );

      if (!rawText) {
        throw new Error(
          'Gemini returned an empty response.'
        );
      }

      let result;

      try {
        result = JSON.parse(rawText);
      } catch (parseError) {
        console.error(
          'Failed to parse Gemini JSON:',
          parseError
        );

        return res.status(500).json({
          success: false,
          valid: false,
          message:
            'Could not understand the image validation result.',
        });
      }

      let confidence =
        Number(result.confidence);

      if (Number.isNaN(confidence)) {
        confidence = 0;
      }

      confidence = Math.max(
        0,
        Math.min(1, confidence)
      );

      const CONFIDENCE_THRESHOLD = 0.75;

      const isGenuineIssue =
        result.isCivicIssue === true &&
        confidence >=
          CONFIDENCE_THRESHOLD;

      console.log(
        'Civic issue:',
        result.isCivicIssue
      );

      console.log(
        'Issue type:',
        result.issueType
      );

      console.log(
        'Confidence:',
        confidence
      );

      console.log(
        'Final validation:',
        isGenuineIssue
      );

      console.log(
        '--------------------------------'
      );

      return res.json({
        success: true,

        valid: isGenuineIssue,

        isCivicIssue:
          result.isCivicIssue === true,

        issueType:
          result.issueType ||
          'Other',

        confidence,

        severity:
          result.severity ||
          'unknown',

        reason:
          result.reason ||
          'No explanation provided.',
      });
    } catch (error) {
      console.error(
        'Image validation error:'
      );

      console.error(error);

      return res.status(500).json({
        success: false,
        valid: false,
        message:
          'Something went wrong while validating the image.',
      });
    }
  }
);

// ========================================
// FINAL REPORT SUBMISSION
// ========================================

app.post(
  '/api/reports',
  upload.single('image'),

  async (req, res) => {
    let uploadedImagePath = null;

    try {
      console.log('');
      console.log('================================');
      console.log(
        'New report submission received'
      );
      console.log('================================');

      // --------------------------------
      // Check authentication
      // --------------------------------

      const authHeader =
        req.headers.authorization;

      if (
        !authHeader ||
        !authHeader.startsWith(
          'Bearer '
        )
      ) {
        return res.status(401).json({
          success: false,
          message:
            'Authentication required.',
        });
      }

      const accessToken =
        authHeader.substring(
          'Bearer '.length
        );

      // --------------------------------
      // Verify Supabase user
      // --------------------------------

      const {
        data: userData,
        error: userError,
      } =
        await supabaseAdmin.auth.getUser(
          accessToken
        );

      if (userError || !userData?.user) {
        console.error(
          'Authentication failed:',
          userError
        );

        return res.status(401).json({
          success: false,
          message:
            'Invalid or expired authentication token.',
        });
      }

      const user =
        userData.user;

      const userId = user.id;

      console.log(
        'Authenticated user:',
        userId
      );

      // --------------------------------
      // Check image
      // --------------------------------

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message:
            'No report image was uploaded.',
        });
      }

      if (
        !allowedImageTypes.includes(
          req.file.mimetype
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Unsupported image format.',
        });
      }

      // --------------------------------
      // Read submitted fields
      // --------------------------------

      const {
        issueType,
        description,
        latitude,
        longitude,
        placeName,
        city,

        severity,

        aiIssueType,
        aiConfidence,
        aiSeverity,
        aiReason,

        capturedAt,
        } = req.body;

      // --------------------------------
      // Validate required fields
      // --------------------------------

      if (
        !issueType ||
        !description ||
        !latitude ||
        !longitude
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Issue type, description, latitude and longitude are required.',
        });
      }

      const latitudeNumber =
        Number(latitude);

      const longitudeNumber =
        Number(longitude);

      if (
        Number.isNaN(latitudeNumber) ||
        Number.isNaN(longitudeNumber)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid latitude or longitude.',
        });
      }

      // --------------------------------
      // Generate report UUID
      // --------------------------------

      const reportId =
        crypto.randomUUID();

      // --------------------------------
      // Determine extension
      // --------------------------------

      let extension = 'jpg';

      if (
        req.file.mimetype ===
        'image/png'
      ) {
        extension = 'png';
      } else if (
        req.file.mimetype ===
        'image/webp'
      ) {
        extension = 'webp';
      } else if (
        req.file.mimetype ===
        'image/heic'
      ) {
        extension = 'heic';
      } else if (
        req.file.mimetype ===
        'image/heif'
      ) {
        extension = 'heif';
      }

      // --------------------------------
      // Storage path
      // --------------------------------
      //
      // reports/
      //    USER_ID/
      //       REPORT_ID.jpg
      //

      uploadedImagePath =
        `${userId}/${reportId}.${extension}`;

      console.log(
        'Uploading image:',
        uploadedImagePath
      );

      // --------------------------------
      // Upload image
      // --------------------------------

      const {
        data: uploadData,
        error: uploadError,
      } =
        await supabaseAdmin.storage
          .from('reports')
          .upload(
            uploadedImagePath,
            req.file.buffer,
            {
              contentType:
                req.file.mimetype,

              cacheControl:
                '3600',

              upsert: false,
            }
          );

      if (uploadError) {
        console.error(
          'Storage upload error:',
          uploadError
        );

        return res.status(500).json({
          success: false,
          message:
            'Failed to upload report image.',
        });
      }

      console.log(
        'Image uploaded successfully:',
        uploadData.path
      );

      // --------------------------------
      // Insert report into database
      // --------------------------------

      const parsedAIConfidence =
        aiConfidence
          ? Number(aiConfidence)
          : null;

      let reportedAt =
        new Date();

      if (capturedAt) {
        const parsedDate =
          new Date(capturedAt);

        if (
          !Number.isNaN(
            parsedDate.getTime()
          )
        ) {
          reportedAt =
            parsedDate;
        }
      }

      const {
        data: reportData,
        error: reportError,
      } =
        await supabaseAdmin
          .from('reports')
          .insert({
            id: reportId,

            user_id: userId,

            image_path:
              uploadedImagePath,

            issue_type:
              issueType.trim(),

            description:
              description.trim(),

            latitude:
              latitudeNumber,

            longitude:
              longitudeNumber,

            place_name:
              placeName
                ? placeName.trim()
                : null,

            city:
                city
                    ? city.trim()
                    : null,

            severity:
              severity
                ? severity.trim()
                : null,

            ai_issue_type:
              aiIssueType
                ? aiIssueType.trim()
                : null,

            ai_confidence:
              Number.isNaN(
                parsedAIConfidence
              )
                ? null
                : parsedAIConfidence,

            ai_severity:
              aiSeverity
                ? aiSeverity.trim()
                : null,

            ai_reason:
              aiReason
                ? aiReason.trim()
                : null,

            reported_at:
              reportedAt.toISOString(),

            status:
              'submitted',
          })
          .select()
          .single();

      // --------------------------------
      // Database failed
      // --------------------------------

      if (reportError) {
        console.error(
          'Database insert error:',
          reportError
        );

        // Delete orphaned image
        await supabaseAdmin.storage
          .from('reports')
          .remove([
            uploadedImagePath,
          ]);

        uploadedImagePath = null;

        return res.status(500).json({
          success: false,
          message:
            'Report could not be saved.',
        });
      }

      // --------------------------------
      // Success
      // --------------------------------

      console.log(
        'Report created:',
        reportData.id
      );

      console.log(
        'User:',
        userId
      );

      console.log(
        '================================'
      );

      return res.status(201).json({
        success: true,

        message:
          'Report submitted successfully.',

        report: {
          id: reportData.id,

          userId:
            reportData.user_id,

          imagePath:
            reportData.image_path,

          issueType:
            reportData.issue_type,

          status:
            reportData.status,

          createdAt:
            reportData.created_at,
        },
      });
    } catch (error) {
      console.error(
        'Report submission error:'
      );

      console.error(error);

      // --------------------------------
      // Cleanup image if necessary
      // --------------------------------

      if (uploadedImagePath) {
        try {
          await supabaseAdmin
            .storage
            .from('reports')
            .remove([
              uploadedImagePath,
            ]);
        } catch (
          cleanupError
        ) {
          console.error(
            'Image cleanup error:',
            cleanupError
          );
        }
      }

      return res.status(500).json({
        success: false,
        message:
          'Something went wrong while submitting the report.',
      });
    }
  }
);

// ========================================
// Start server
// ========================================

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log('');

    console.log(
      `Civik Backend running on http://localhost:${PORT}`
    );

    console.log('');
  }
);