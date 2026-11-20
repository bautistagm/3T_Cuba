# 3T — Instrucciones para trabajar en este repositorio

App de gestión del tercer tiempo del plantel de rugby (cuotas, fiestas, sábados, caja; stock en 2027).
El dueño del proyecto es Bautista. Hablale en español rioplatense, claro y sin jerga técnica innecesaria.

## Regla principal: costo cero
La app no puede generar ningún gasto (hosting, base, comisiones, mensajes, IA). Toda pieza nueva necesita una opción gratis; si no la tiene, no entra. Ver `docs/DISENO.md`.

## Antes de cambiar algo
- Leé `docs/DISENO.md`: es la fuente de verdad de reglas de negocio, seguridad, modelo de datos y etapas.
- Si un pedido cambia una regla de negocio, primero actualizá `docs/DISENO.md` y confirmalo con Bautista; después el código.
- Se trabaja **despacio y por etapas**: una etapa a la vez, con tests pasando y revisión de Bautista antes de seguir.

## Reglas que nunca se rompen (manejo de plata)
- Montos en centavos, enteros (`BIGINT`). Nunca floats.
- La plata nunca se borra: se anula con motivo, autor y fecha. Solo el dueño anula, da de baja o elimina.
- Todo movimiento de plata pasa por el libro `movimientos_caja`, dentro de una transacción.
- Mercado Pago solo en lectura. Un movimiento de la cuenta confirma como máximo un pago; un número de operación no se usa dos veces.
- La IA confirma sola solo lo que puede verificar contra los movimientos reales de la cuenta; si hay cualquier duda, confirma una persona.
- Secretos solo en variables de entorno. Nunca en el repositorio.

## Registro de decisiones
Cada decisión nueva de Bautista se agrega a `docs/DISENO.md` en el commit que la implementa.
