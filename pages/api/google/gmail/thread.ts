import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { google } from 'googleapis';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[gmail/thread] Processing request for thread:', req.query.threadId);
    const session = await getSession({ req });
    
    if (!session?.accessToken) {
      console.log('[gmail/thread] No access token found');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { threadId } = req.query;
    if (!threadId || typeof threadId !== 'string') {
      console.log('[gmail/thread] Invalid thread ID:', threadId);
      return res.status(400).json({ error: 'Thread ID is required' });
    }

    console.log('[gmail/thread] Creating OAuth2 client...');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.error('[gmail/thread] Missing Google OAuth credentials');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    oauth2Client.setCredentials({
      access_token: session.accessToken as string,
      refresh_token: session.refreshToken as string,
    });

    console.log('[gmail/thread] Initializing Gmail client...');
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
      // Try to list messages first to validate our access
      console.log('[gmail/thread] Validating Gmail access...');
      await gmail.users.messages.list({
        userId: 'me',
        maxResults: 1
      });

      // First try to get the thread directly
      console.log('[gmail/thread] Attempting to fetch thread directly:', threadId);
      try {
        const threadResponse = await gmail.users.threads.get({
          userId: 'me',
          id: threadId,
          format: 'full'
        });
        
        if (!threadResponse.data.messages) {
          throw new Error('Thread has no messages');
        }

        console.log('[gmail/thread] Processing', threadResponse.data.messages.length, 'messages');
        const messages = await Promise.all(threadResponse.data.messages.map(async (message: any, index: number) => {
          try {
            console.log(`[gmail/thread] Processing message ${index + 1}/${threadResponse.data.messages?.length}`);
            const headers = message.payload?.headers || [];
            const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '(no subject)';
            const from = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value || '';
            const date = headers.find((h: any) => h.name?.toLowerCase() === 'date')?.value || '';
            
            // Extract the message body
            let body = '';

            // Helper function to decode base64 content
            const decodeBody = (data: string) => {
              try {
                // Replace URL-safe characters back to standard base64
                const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
                // Add padding if needed
                const pad = normalized.length % 4;
                const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
                return Buffer.from(padded, 'base64').toString('utf-8');
              } catch (error) {
                console.error('[gmail/thread] Error decoding message body:', error);
                return '';
              }
            };

            // Function to recursively process MIME parts
            const processPart = (part: any) => {
              try {
                if (part.body?.data) {
                  body += decodeBody(part.body.data);
                } else if (part.parts) {
                  part.parts.forEach((subPart: any) => {
                    processPart(subPart);
                  });
                }
              } catch (error) {
                console.error('[gmail/thread] Error processing MIME part:', error);
              }
            };

            // Process the message payload
            if (message.payload) {
              processPart(message.payload);
            }

            return {
              id: message.id,
              threadId: message.threadId,
              subject,
              from,
              date,
              body: body.trim() || '(no content)',
            };
          } catch (error) {
            console.error(`[gmail/thread] Error processing message ${index + 1}:`, error);
            return {
              id: message.id || 'unknown',
              threadId: message.threadId || threadId,
              subject: '(error processing message)',
              from: '(unknown)',
              date: new Date().toISOString(),
              body: 'Error processing this message.',
            };
          }
        }));

        console.log('[gmail/thread] Successfully processed thread');
        res.status(200).json({ messages });
      } catch (error: any) {
        // If thread fetch fails, try to get the message and then its thread
        console.log('[gmail/thread] Thread fetch failed, trying message fetch:', error.message);
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: threadId,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date']
        });

        if (!messageResponse.data.threadId) {
          throw new Error('No thread ID found in message');
        }

        // Now get the full thread using the thread ID from the message
        const threadResponse = await gmail.users.threads.get({
          userId: 'me',
          id: messageResponse.data.threadId,
          format: 'full'
        });

        if (!threadResponse.data.messages) {
          throw new Error('Thread has no messages');
        }

        // Process messages as before...
        const messages = await Promise.all(threadResponse.data.messages.map(async (message: any, index: number) => {
          // ... same message processing code as above ...
          try {
            console.log(`[gmail/thread] Processing message ${index + 1}/${threadResponse.data.messages?.length}`);
            const headers = message.payload?.headers || [];
            const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '(no subject)';
            const from = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value || '';
            const date = headers.find((h: any) => h.name?.toLowerCase() === 'date')?.value || '';
            
            let body = '';
            const decodeBody = (data: string) => {
              try {
                const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
                const pad = normalized.length % 4;
                const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
                return Buffer.from(padded, 'base64').toString('utf-8');
              } catch (error) {
                console.error('[gmail/thread] Error decoding message body:', error);
                return '';
              }
            };

            const processPart = (part: any) => {
              try {
                if (part.body?.data) {
                  body += decodeBody(part.body.data);
                } else if (part.parts) {
                  part.parts.forEach((subPart: any) => processPart(subPart));
                }
              } catch (error) {
                console.error('[gmail/thread] Error processing MIME part:', error);
              }
            };

            if (message.payload) {
              processPart(message.payload);
            }

            return {
              id: message.id,
              threadId: message.threadId,
              subject,
              from,
              date,
              body: body.trim() || '(no content)',
            };
          } catch (error) {
            console.error(`[gmail/thread] Error processing message ${index + 1}:`, error);
            return {
              id: message.id || 'unknown',
              threadId: message.threadId || threadId,
              subject: '(error processing message)',
              from: '(unknown)',
              date: new Date().toISOString(),
              body: 'Error processing this message.',
            };
          }
        }));

        console.log('[gmail/thread] Successfully processed thread');
        res.status(200).json({ messages });
      }
    } catch (error: any) {
      console.error('[gmail/thread] Error:', error);
      console.error('[gmail/thread] Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        response: error.response?.data,
      });
      res.status(500).json({ 
        error: 'Failed to fetch email thread',
        details: error.message,
        code: error.code || 500,
      });
    }
  } catch (error: any) {
    console.error('[gmail/thread] Error:', error);
    console.error('[gmail/thread] Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });
    res.status(500).json({ 
      error: 'Failed to fetch email thread',
      details: error.message,
      code: error.code,
    });
  }
} 