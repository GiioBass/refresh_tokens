# Guía de Telemetría de Autenticación y Simulador de Estrés

Esta guía explica cómo ejecutar las herramientas de simulación de estrés y concurrencia integradas y cómo visualizar los fallos a través del sistema de telemetría de base de datos.

---

## 🚀 1. Ejecutar las Migraciones en el Backend
Antes de empezar con las pruebas de estrés, asegúrate de aplicar la nueva migración en tu backend local:
```bash
php artisan tenant:migrate --environment=qa
```
Esto creará la tabla `auth_failures_telemetry` que registrará silenciosamente todos los fallos y anomalías en las rotaciones de tokens.

---

## ⚡ 2. Ejecutar el Simulador de Estrés
Hemos colocado el simulador de estrés `auth-stress-simulator.js` directamente en la raíz de este proyecto de pruebas. 

Para ejecutarlo, sigue estos pasos:

1. Instala la dependencia `axios` (si no lo está ya en el proyecto):
   ```bash
   npm install axios
   ```

2. Ejecuta el simulador con Node.js:
   ```bash
   node auth-stress-simulator.js --url=http://localhost:8001/api/v2 --users=5 --concurrency=3
   ```

### ⚙️ Parámetros Configurables:
- `--url`: URL base de tu API de Laravel (por defecto: `http://localhost:8001/api/v2`).
- `--users`: Cantidad de usuarios virtuales que iniciarán sesión en paralelo (por defecto: `5`).
- `--concurrency`: Peticiones simultáneas concurrentes por usuario utilizando tokens inválidos para forzar flujos de refresco paralelos interceptados (por defecto: `3`).
- `--client`: Tipo de cliente a simular (`mobile` para flujo JSON, `web` para flujo de cookies).

---

## 📊 3. Monitorear los Registros de Telemetría
Puedes auditar los fallos y replay attacks interceptados de tres maneras:

1. **Desde la Base de Datos directamente:**
   ```sql
   SELECT * FROM auth_failures_telemetry ORDER BY id DESC LIMIT 15;
   ```
2. **Consultando el Endpoint de Telemetría en el Backend:**
   Realiza una petición `GET` a `/api/v2/auth/login/telemetry` con un Bearer Token válido.
3. **Desde el Panel de Control Web:**
   Hemos implementado una pestaña de **Telemetría de Seguridad** directamente en la consola del proyecto web de pruebas donde puedes auditar, recargar y analizar detalladamente el volcado de cabeceras (`headers_dump`) y el payload de cada anomalía de autenticación detectada.
