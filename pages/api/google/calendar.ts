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
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: session.accessToken as string,
      refresh_token: session.refreshToken as string,
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get number of weeks from query parameter, default to 2 weeks
    const weeks = parseInt(req.query.weeks as string) || 2;
    
    // Get today's date at midnight
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get date after specified number of weeks at midnight
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + (weeks * 7));

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: today.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items?.map(event => ({
      id: event.id,
      summary: event.summary,
      description: event.description,
      start: event.start,
      end: event.end,
      attendees: event.attendees,
    })) || [];

    res.status(200).json({ events });
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
} 