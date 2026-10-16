# SkillTanki Mobile — PWA

Мобильный клиент SkillTanki: отдельное приложение (как PUBG Mobile рядом с
PUBG), которое переиспользует движок десктопного клиента из
`packages/game/src` **копией** в `src/engine/` (см. `src/engine/README.md`), но имеет свою
чистую архитектуру: DI-контейнер на `di-kit`, единый контракт управления,
умные боты под все режимы, тач-интерфейс и рекламные слоты.

Первый релиз — только бои с ботами. Мультиплеер (mesh по управлению)
заходит следующим шагом в уже заложенные швы.

## Запуск

```bash
npm install                       # из корня монорепо (workspaces: packages/*, apps/*)
npm run dev -w skilltanki-mobile  # http://localhost:5173 (предхук копирует ассеты)
npm run build -w skilltanki-mobile
npm run preview -w skilltanki-mobile
```

Ассеты игра всегда берёт с `window.location.origin` + `/assets/`: в dev Vite
проксирует `/assets`, `/api` и `/ws` на бэкенд (`npm run dev:server` во второй
вкладке — wrangler dev на :8787 раздаёт `assets/` репо), в prod тот же воркер
отдаёт их рядом с оболочкой. В `public/` лежат только иконки и логотип. Для отладки на десктопе
работает клавиатура: WASD/стрелки, Z/X/C, Space, 1–5, 0, Q/E.

## Ассеты: что в бандле, что из облака

Источник облачных ассетов — `https://game.skilltanki.workers.dev/assets/`
(воркер отдаёт `packages/game/public` из R2). Константа
`CC_REMOTE_ASSET_BASE` в `src/config/params.ts`.

| Где            | Что                                                                                                                             | Объём |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **В бандле**   | манифесты (maps/hulls/turrets/paints/assets.json), UI-спрайты и скины HP-бара, иконки, все звуки, превью корпусов/башен, Hunter M0 + Smoky M0, карта Island с замыканием пропов и её skybox, эффекты смерти | ~8 МБ |
| **Из облака**  | остальные 52 карты и библиотеки пропов, 101 краска, остальные корпуса/башни и их спрайты эффектов, другие skybox'ы, тумбнейлы карт | ~175 МБ |

Список бандла формирует `scripts/sync-bundle.mjs` (запускается
pre-хуком build) в `public/bundled` + `public/bundle.manifest.json`.
При старте `src/config/assets.ts` читает манифест и ставит в движок
резолвер: путь есть в бандле → локально, иначе → облако. Service worker
(`vite-plugin-pwa`) прекэширует оболочку и бандл, а облачные ответы кладёт в
CacheFirst на 30 дней (`CC_ASSET_CACHE_VERSION` — ручной сброс).

**Важно:** воркер должен отдавать CORS на `/assets/*`. Патч уже в
`packages/server/src/index.ts`; нужен деплой `npm run deploy -w skilltanki-server`.

## Структура

```
apps/mobile/
  index.html, vite.config.ts, tsconfig.json   PWA-манифест, workbox
  public/icons/*, public/logo.png             иконки (branding/) и логотип форм
  src/
    main.ts                 порядок старта: резолвер ассетов → SW → DI-модуль → boot
    config/params.ts        все константы сборки (CC_*)
    config/assets.ts        резолвер /assets/ на своём origin, ставится в движок до его импорта
    model/                  чистые типы: TankCommand, ControlSource, BattleConfig,
                            Perception, Objective, BattleEvents, Ads
    classes/                объекты с состоянием: TankActor, CommandBuffer, BotMemory,
                            FixedStepper, TypedEmitter, strategies/* (DM, TDM, CTF, Assault)
    ui/theme.css, ui/dom.ts фирменный стиль (панели, 9-slice кнопки SWF, зелёный акцент)
    lib/tanki/              DI-модуль (di-kit): core/{di,types,provide}.ts, index.ts
      services/base         Logger, Storage, Engine (PlayCanvas app), Ad (провайдер рекламы)
      services/asset        AssetSource, AssetCatalog (манифесты)
      services/control      TouchInput (источник игрока), ControlRegistry, TankDriver
      services/bot          BotPerception, BotNavigation, BotGunner, BotSupply,
                            BotStrategy, BotBrain (бот как ControlSource)
      services/mode         ModeRule (команды, ростер, враждебность), FlagMode (CTF/Assault)
      services/battle       BattleState, BattleEvent, MapStage, Effects, Combat, TankSpawn,
                            Respawn, Score, Clock, Camera, BattleLoop, BattleSession
      services/ui           UiRoot, LoadingScreen, Menu, Hud, TouchControls, Pause, Result
      services/public       GameFacade — публичный API приложения
```

Паттерн как в бэкенд-библиотеках: `core/types.ts` — символы по категориям,
`core/provide.ts` — фабрики, `index.ts` — агрегат `tanki` + `init()`;
сервисы — классы с полями `inject<T>(TYPES.x)` и стрелочными методами.
`globalThis.tanki` доступен в консоли для отладки.

## Управление — один контракт для всех

`model/TankCommand.ts` — единственный способ управлять танком:

```ts
interface TankCommand {
  move: number; turn: number; reverseBackTurn: boolean;   // -1..1, аналог
  turret: -1|0|1; turretCenter: boolean; turretTarget: Vec3|null;
  aimPoint: Vec3|null; pitch: number|null;                 // прицел (боты/Шафт)
  fire: boolean; supply: SupplyKind|null; selfDestruct: boolean; cameraTilt: -1|0|1;
}
```

Поток команд асинхронный и push-модельный (`model/ControlSource.ts`):
источник **пушит** команды в `CommandBuffer` актора со штампом тика, цикл боя
на каждом физическом шаге берёт команду `≤ tick`. Три источника с одним
интерфейсом:

- `TouchInputService.createSource()` — тач/клавиатура игрока;
- `BotBrainService.createSource(actor, difficulty)` — бот, думает в `tick()`;
- remote (заглушка `kind: 'none'`) — будущий mesh-пир: пакеты приходят
  когда угодно, буфер сортирует по тику и повторяет последнюю при лаге.

`ControlRegistryService.replace(actor, source)` меняет мозг на человека и
обратно на лету. `TankDriverService.apply()` — единственное место, где
команда превращается в вызовы `GameTank`.

## Боты

Бот = `perceive → decide → steer → aim → push(TankCommand)`:

- `BotPerceptionService` — read-only вид мира (танки, LOS-рейкасты, флаги,
  спавны). Мозги не трогают `GameTank`/физику напрямую.
- `BotStrategyService` + `classes/strategies/*` — цель на тик (`Objective`):
  `hunt` / `goto` / `hold` / `roam`. Стратегии: DM (ближайший видимый),
  TDM (защита раненых союзников, наступление на спавн врага), CTF (роли
  attacker/defender, перехват вора, эскорт носителя), Assault (носитель
  своего флага к чужой базе).
- `BotNavigationService` — рулёжка к точке/цели, keep-away от усиленного
  врага, застревание → реверс, патруль в `hold`.
- `BotGunnerService` — модель прицеливания десктопного бота (блуждающая
  ошибка, реакция, лаг по цели) с профилями easy/normal/hard.
- `BotSupplyService` — припасы у ботов тоже есть (аптечка, броня, урон,
  нитро носителю, ядерка на hard).

## Бой

`BattleSessionService.start(config)` собирает всё в фиксированном порядке
(стадия карты → эффекты → счёт → камера → бой → танки → респавн → флаги)
и `dispose()` разбирает — без перезагрузки страницы. `BattleLoopService`:
фиксированный шаг 33 мс (`FixedStepper`), интерполяция рендера; на шаге —
`collect` команд, `driver.apply`, физика, припасы, респавн, статусы, флаги,
часы. Пауза останавливает симуляцию (одиночная игра).

Логика эмитит данные в `BattleEventService` (`death`, `flag`, `teamScore`,
`clock`, `finished`…), HUD подписывается — HTML в логике нет.

## UI и реклама

Стартовое меню — в языке HUD: верхняя полоса (логотип, заголовок, позывной),
вкладки TANK / MODE / MAP внизу и круглая PLAY в углу большого пальца; корпус,
башня, краска и карты — лентами плиток, режимы — сеткой, опции боя — чипами.
Дальше бой → пауза → результат. Логотип (`public/logo.png`) на каждой форме,
иконка PWA из `icon.png`. Реклама только модальная: `CC_AD_PLACEMENTS` —
interstitial перед стартом боя и на CONTINUE результата. `AdService.setProvider()`
принимает реализацию `model/Ads.ts#AdProvider`; по умолчанию no-op.

## Дорожная карта

1. Мультиплеер (mesh): `RemoteControlSource` + транспорт, который возит
   `TankCommand` со штампом тика и периодические снапшоты состояния для
   коррекции (физика недетерминирована: `Math.random` в солвере контактов,
   поэтому чистый lockstep невозможен — см. отчёт в packages/server/PLAN.md).
2. Capacitor-лаунчер для Google Play: тот же `dist/`, AdMob-провайдер.
3. Выбор качества графики для слабых телефонов (pixel ratio, тени).
