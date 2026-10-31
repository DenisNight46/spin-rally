# Spin Rally — переработка физики и онлайна

## Что изменено

- Переписана физика мяча в `contracts/sim.ts`: фиксированный шаг 240 Гц, квадратичное сопротивление воздуха, эффект Магнуса, затухание вращения, трение при отскоке от стола.
- Контакт ракетки рассчитывается по относительной скорости, нормальному импульсу и касательному трению; движение ракетки автоматически создаёт верхнее/нижнее и боковое вращение.
- Зона контакта уменьшена до размера, близкого к реальной игровой ракетке.
- Подача запускается кликом по игровому полю или экранной кнопкой; скорость и вращение зависят от движения ракетки.
- Удалены пользовательские переключатели «Сила» и «Резка».
- ИИ учитывает отскок при прогнозе точки встречи и выполняет подготовительное движение/замах.
- Онлайн-клиент хранит буфер сетевых снимков и интерполирует мяч/дальнюю ракетку; локальная ракетка отображается по более свежему состоянию.
- Код комнаты увеличен до шести символов. Добавлена ссылка-приглашение `?room=XXXXXX` с автоматическим входом и кнопкой переподключения.
- Обновлены визуальные материалы ракетки и стола.
- Добавлены физические smoke/unit tests в `api/sim.test.ts`.

## Проверки

- Все TypeScript/TSX файлы прошли синтаксическую транспиляцию.
- Ключевые физические и клиентские модули прошли отдельную строгую проверку TypeScript.
- Отдельный smoke-тест подтвердил разные компоненты вращения от вертикального и бокового движения ракетки, две правильные подачи-отскока и возврат мяча ИИ.
- Полный `npm run check`, `npm run build` и Playwright-проверка не были выполнены: установка зависимостей в среде подготовки завершилась тайм-аутом, `node_modules` не был полностью установлен.

## Известные ограничения

Физическая модель стала существенно ближе к реальному настольному теннису, но пока не откалибрована по высокоскоростной съёмке реальных ударов и конкретным типам накладок/оснований. Для следующего этапа нужны измерения скорости мяча, угловой скорости и точек отскока. Онлайн-матчи используют временные комнаты в памяти сервера; для публичного продакшена понадобятся устойчивое хранение/восстановление комнат, защита от злоупотреблений и нагрузочное тестирование.

## Release candidate — 2026-10-31

- Fixed an undefined `wood` material in racket-handle construction that could stop scene initialization.
- Added articulated upper-arm/forearm/elbow segments and lightweight footwork response to racket movement.
- Added a subtle ball seam so angular rotation is perceptible in the rendered scene.
- Increased racket-head speed/acceleration caps to support faster, more natural mouse/touch strokes without teleporting the racket.
- Hardened pointer handling so secondary touches cannot steal racket control or trigger a serve.
- Added a legacy clipboard fallback for invitation links on browsers without Clipboard API access.
- Changed authoritative online simulation to use an elapsed-time accumulator with a fixed 120 Hz step, capped catch-up, and 30 Hz state snapshots to reduce timing drift under server load.
- Added `/health`, Docker deployment files, Render Blueprint, and a WebSocket integration test covering room creation, guest join, state broadcast, ping, and disconnect.
- Verified physics invariants with an isolated TypeScript compile and Node assertions: regulation geometry, swing-derived topspin/sidespin, and two-bounce serve trajectory. Verified the AI can physically return a serve.
- Full dependency installation, production build, Playwright browser run, and live two-device internet test remain pending because package installation timed out in this environment; no public host has been provisioned.
