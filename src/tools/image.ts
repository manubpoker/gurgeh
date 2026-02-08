import { logger } from '../logger';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-3-pro-image-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface ImageResult {
  imageData: Buffer;
  mimeType: string;
  textResponse?: string;
}

export async function generateImage(
  prompt: string,
  aspectRatio: string = '16:9'
): Promise<ImageResult | null> {
  if (!GEMINI_API_KEY) {
    logger.error('GEMINI_API_KEY not set — image generation unavailable');
    return null;
  }

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['Text', 'Image'],
      imageConfig: { aspectRatio },
    },
  };

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Gemini API error', { status: response.status, error: errorText.slice(0, 500) });
      return null;
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            inlineData?: { mimeType: string; data: string };
          }>;
        };
      }>;
    };

    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      logger.error('Gemini returned no parts');
      return null;
    }

    let imageData: Buffer | null = null;
    let mimeType = 'image/png';
    let textResponse: string | undefined;

    for (const part of parts) {
      if (part.inlineData) {
        imageData = Buffer.from(part.inlineData.data, 'base64');
        mimeType = part.inlineData.mimeType || 'image/png';
      } else if (part.text) {
        textResponse = part.text;
      }
    }

    if (!imageData) {
      logger.error('Gemini returned no image data', { textResponse });
      return null;
    }

    logger.info('Image generated', { size: imageData.length, mimeType, hasText: !!textResponse });
    return { imageData, mimeType, textResponse };
  } catch (err) {
    logger.error('Image generation failed', { error: String(err) });
    return null;
  }
}
