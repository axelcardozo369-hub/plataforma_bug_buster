import app from "./app.js";
import { env } from "./src/config/env.js";
import { sequelize } from "./src/models/index.js";
import { estadoIA } from "./src/services/ia/index.js";
import { retomarPendientes } from "./src/services/procesador.service.js";

const iniciarServidor = async () => {
  try {
    await sequelize.sync({ force: true });
    console.log("✔ Conexión a MySQL establecida");

    await sequelize.sync({ alter: env.DB_SYNC_ALTER });
    console.log("✔ Modelos sincronizados");

    const ia = estadoIA();
    console.log(
      ia.configurada
        ? `✔ IA activa: ${ia.proveedor} (${ia.modelo})`
        : `⚠ IA no configurada: ${ia.motivo}. Solo se analizarán textos y planillas.`,
    );

    app.listen(env.PORT, async () => {
      console.log(`🚀 InfoHub corriendo en http://localhost:${env.PORT}`);
      const retomadas = await retomarPendientes();
      if (retomadas)
        console.log(
          `↻ Retomando ${retomadas} fuente(s) que quedaron sin procesar`,
        );
    });
  } catch (error) {
    console.error("✖ No se pudo iniciar el servidor:", error.message);
    process.exit(1);
  }
};

iniciarServidor();
