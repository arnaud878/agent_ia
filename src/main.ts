import './load-env';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

/**
 * Page HTTPS (ex. front via ngrok) → API sur localhost / réseau local : Chrome envoie un
 * prévol PNA avec `Access-Control-Request-Private-Network: true`. Sans la réponse
 * correspondante, la requête est bloquée (souvent affichée comme erreur CORS).
 */
function allowPrivateNetworkAccess(req: Request, res: Response, next: NextFunction) {
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(allowPrivateNetworkAccess);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
