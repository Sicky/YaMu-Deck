# Управление из быстрых настроек Steam Deck — 0.3.0

Yamu экспортирует системный медиаплеер MPRIS на Linux/SteamOS. Управление: предыдущий/следующий трек, пауза/продолжение, остановка, перемотка и громкость. Передаются название, исполнитель, альбом, обложка и позиция. Моя волна использует тот же плеер и продолжает пополнять очередь. Приложение должно оставаться запущенным.

## Панель `…` в Gaming Mode

Штатная вкладка музыки Steam не считается поддерживаемым способом управления сторонним Yamu. Для этой версии используйте Decky Loader с совместимым плагином Music Control, работающим через MPRIS. Автоматическая установка Decky/плагина и изменение SteamOS приложением не выполняются.

1. Установите/обновите Decky Loader по [документации проекта](https://github.com/SteamDeckHomebrew/decky-loader).
2. Установите совместимый Music Control через магазин Decky. В [базе плагинов Decky](https://github.com/SteamDeckHomebrew/decky-plugin-database/blob/main/.gitmodules) указан репозиторий [martinpl/MusicControl](https://github.com/martinpl/MusicControl). Совместимость версии плагина с текущими Steam/Decky проверяйте у его автора; старый mirobouma/MusicControl архивирован.
3. Добавьте Linux-версию Yamu в Steam как стороннюю игру. Proton не включайте.
4. Запустите Yamu из Gaming Mode, войдите и включите музыку.
5. Переключитесь в игру через меню Steam, не закрывая Yamu.
6. Нажмите `…` → Decky → Music Control → выберите **Yamu**. Используйте кнопки переключения и паузы.

Если в списке присутствует отдельный Chromium-плеер, выбирайте именно Yamu. Поддержка сторонних плагинов зависит от версии SteamOS/Steam/Decky. Без Decky остаются управление внутри Yamu и системные MPRIS-клиенты в Desktop Mode.

## Linux-архив из Windows-среды сборки

Готовый архив: `dist/0.3.0-linux/yamu-deck-0.3.0.tar.gz`. Распакуйте его в постоянную папку, например `/home/deck/Applications/Yamu`. В каталоге с `start-yamu.sh` выполните:

```sh
chmod +x start-yamu.sh
./start-yamu.sh --fullscreen
```

Скрипт разрешает исполнение только трём включённым бинарным файлам при необходимости и запускает Yamu с обычной песочницей Electron. Добавьте `start-yamu.sh` в Steam; рабочая папка — каталог этого файла; параметр запуска — `--fullscreen`. Архив для Linux собран на Windows, выполнение бинарного файла на Linux в текущей среде не проверено. AppImage по-прежнему собирается через Linux workflow.

## Диагностика

В настройках Yamu отображается состояние системного управления. Для MPRIS нужна пользовательская session bus, сервис `org.mpris.MediaPlayer2.yamu`, путь `/org/mpris/MediaPlayer2`. Запускайте от пользователя `deck`, без sudo и без изолированной D-Bus-сессии. Одновременно используйте один экземпляр Yamu. При недоступной шине обычный плеер продолжает работать.

Если установлен `playerctl`, в Desktop Mode проверьте:

```sh
playerctl --list-all
playerctl --player=yamu metadata
playerctl --player=yamu play-pause
playerctl --player=yamu next
```

Если `playerctl` управляет Yamu, а панель `…` — нет, проверьте версию/настройки Decky-плагина. Если нет самого сервиса Yamu, проверьте пользовательскую шину и статус в настройках приложения.

## Безопасность и проверки

Это локальный session D-Bus, без HTTP-порта и сетевого сервера. Токен Яндекса, cookie, подписанная аудиоссылка и ключ FLAC не входят в MPRIS-метаданные. Системные приложения того же пользователя могут видеть название текущего трека и отправлять стандартные медиакоманды. OpenUri намеренно не открывает URL и файлы; shell-команды через D-Bus не выполняются. Windows сохраняет управление через Media Session и не запускает D-Bus.

Локально проверены модуль MPRIS с имитацией шины, фильтрация метаданных, команды до интерфейса Electron и существующие сценарии плеера. Полный D-Bus roundtrip добавлен в Linux CI: `dbus-run-session -- npm run test:mpris`. Физический Steam Deck, реальная Linux-шина, актуальный Decky и работа панели `…` здесь не проверялись — это следующий этап проверки на устройстве.

Основание интерфейса: [спецификация MPRIS](https://specifications.freedesktop.org/mpris/latest/Player_Interface.html). Описанный принцип работы Music Control подтверждён [документацией плагина](https://github.com/mirobouma/MusicControl/blob/main/README.md).
