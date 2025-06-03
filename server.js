require('dotenv').config();
const mongoose = require('mongoose');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');

const mongoUri = process.env.MONGODB_URI ;

(async () => {
  try {
    // 1. Conectar a MongoDB
    await mongoose.connect(mongoUri);
    console.log('✅ Conectado a MongoDB');

    // 2. Crear MongoStore
    const store = new MongoStore({ mongoose });

    // 3. Crear cliente WhatsApp con RemoteAuth
    const client = new Client({
      authStrategy: new RemoteAuth({
        store,
        backupSyncIntervalMs: 300000, // 5 min
        clientId: 'bot-wha' // <- usa siempre el mismo para evitar QR
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox']
      }
    });

    // 4. Eventos del cliente
    client.on('qr', (qr) => {
      qrcode.generate(qr, { small: true });
      console.log('⚠️ Escanea el QR para iniciar sesión');
    });

    client.on('ready', () => {
      console.log('🎉 Cliente WhatsApp listo');
    });

    client.on('auth_failure', msg => {
      console.error('❌ Fallo de autenticación:', msg);
    });

    client.on('disconnected', reason => {
      console.warn('⚠️ Cliente desconectado:', reason);
    });

    await client.initialize();

    // 5. Crear servidor Express
    const app = express();
    app.use(bodyParser.json());

    app.post('/send', async (req, res) => {
      const { nombre, numero, pedido } = req.body;
      if (!nombre || !numero || !pedido)
        return res.status(400).send('Faltan datos');

      try {
        const chatId = `${numero}@c.us`;
        const mensaje = `Hola ${nombre}, hemos recibido tu pedido:\n${pedido}`;
        await client.sendMessage(chatId, mensaje);
        res.status(200).send('Mensaje enviado con éxito');
      } catch (err) {
        console.error('Error al enviar mensaje:', err);
        res.status(500).send('Error interno');
      }
    });

    const port = process.env.PORT || 3000;
    const server = app.listen(port, () => {
      console.log(`🚀 Servidor Express escuchando en http://localhost:${port}`);
    });

    // 6. Manejo de cierre
    async function shutdown() {
      console.log('🛑 Cerrando cliente y servidor...');
      await client.destroy();
      await mongoose.disconnect();
      server.close(() => {
        console.log('✅ Apagado limpio');
        process.exit(0);
      });
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    console.error('❌ Error general:', err);
  }
})();
