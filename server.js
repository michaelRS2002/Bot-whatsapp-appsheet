require('dotenv').config();
const mongoose = require('mongoose');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');

// 1. URI de Mongo
const mongoUri = process.env.MONGODB_URI;

// 2. Modelo de mensajes pendientes
const mensajeSchema = new mongoose.Schema({
  nombre: String,
  numero: String,
  pedido: String,
  timestamp: { type: Date, default: Date.now }
});
const MensajePendiente = mongoose.model('MensajePendiente', mensajeSchema);

(async () => {
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Conectado a MongoDB');

    const store = new MongoStore({ mongoose });
    const client = new Client({
      authStrategy: new RemoteAuth({
        store,
        backupSyncIntervalMs: 300000,
        clientId: 'bot-whatsapp'
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox']
      }
    });

    client.on('qr', qr => {
      qrcode.generate(qr, { small: true });
      console.log('⚠️ Escanea el QR');
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

    // 3. Servidor Express
    const app = express();
    app.use(bodyParser.json());

    app.post('/send', async (req, res) => {
      const { nombre, numero, pedido } = req.body;
      if (!nombre || !numero || !pedido)
        return res.status(400).send('Faltan datos');

      const chatId = `${numero}@c.us`;
      const mensaje = `Hola ${nombre}, hemos recibido tu pedido:\n${pedido}`;

      try {
        await client.sendMessage(chatId, mensaje);
        res.status(200).send('✅ Mensaje enviado');
      } catch (err) {
        console.warn('⏳ Guardando mensaje pendiente por error:', err.message);
        await MensajePendiente.create({ nombre, numero, pedido });
        res.status(202).send('Mensaje guardado para reintento');
      }
    });

    const port = process.env.PORT || 3000;
    const server = app.listen(port, () => {
      console.log(`🚀 Servidor escuchando en http://localhost:${port}`);
    });

    // 4. Reintentar mensajes pendientes cada 30 segundos
    setInterval(async () => {
      if (!client.info || !client.info.wid) return; // cliente no listo

      const pendientes = await MensajePendiente.find().limit(10);
      for (const msg of pendientes) {
        try {
          const chatId = `${msg.numero}@c.us`;
          const texto = `Hola ${msg.nombre}, hemos recibido tu pedido:\n${msg.pedido}`;
          await client.sendMessage(chatId, texto);
          await msg.deleteOne();
          console.log(`✅ Reenviado a ${msg.numero}`);
        } catch (err) {
          console.warn(`❌ Falló reintento a ${msg.numero}:`, err.message);
        }
      }
    }, 30000);

    // 5. Apagado limpio
    async function shutdown() {
      console.log('🛑 Cerrando...');
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
