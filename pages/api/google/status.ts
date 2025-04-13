import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { google } from 'googleapis';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await getSession({ req });
    
    if (!session?.accessToken) {
      return res.status(200).json({
        gmailConnected: false,
        calendarConnected: false,
      });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: session.accessToken as string,
      refresh_token: session.refreshToken as string,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Test both services
    const [gmailProfile, calendarList] = await Promise.all([
      gmail.users.getProfile({ userId: 'me' }).catch(() => null),
      calendar.calendarList.list().catch(() => null),
    ]);

    res.status(200).json({
      gmailConnected: !!gmailProfile,
      calendarConnected: !!calendarList,
    });
  } catch (error) {
    console.error('Error checking Google services status:', error);
    res.status(500).json({ error: 'Failed to check Google services status' });
  }
} 