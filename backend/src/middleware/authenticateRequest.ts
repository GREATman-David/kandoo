import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';

import { supabase } from '../services/supabase';

export type AuthenticatedRequest = Request & {
  user: {
    id: string;
    email?: string;
  };
};

export async function authenticateRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        error: 'Missing authorization header.',
      });
    }

    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({
        error: 'Invalid authorization format.',
      });
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    // "Can't reach Supabase to check" is NOT "this token is bad". Answering 401
    // for a network failure made the app sign the user out whenever the server
    // lost its connection; 503 tells the client to treat it as offline.
    if (error && (isAuthRetryableFetchError(error) || !error.status || error.status >= 500)) {
      console.error('Token verification unavailable:', error);
      return res.status(503).json({
        error: 'Kandoo could not verify your session just now. Please try again.',
      });
    }

    if (error || !user) {
      return res.status(401).json({
        error: 'Invalid or expired access token.',
      });
    }

    (req as AuthenticatedRequest).user = {
      id: user.id,
      email: user.email,
    };

    next();
  } catch (error) {
    // An exception here is the verification call failing, not a verdict on
    // the token — same reasoning as above.
    console.error('Authentication error:', error);

    return res.status(503).json({
      error: 'Kandoo could not verify your session just now. Please try again.',
    });
  }
}