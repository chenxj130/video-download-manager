import type { Request, Response, NextFunction, Router } from 'express';

export function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export function sendError(res: Response, code: string, message: string, status: number) {
  res.status(status).json({ error: { code, message } });
}
