#!/usr/bin/env bash
# DEPRECATED: Используйте install-control.sh для Control Panel (Docker)
# или install-node.sh для Node Agent.
#
# Этот скрипт оставлен для совместимости. Рекомендуется:
#   ./install-control.sh  — на главном сервере
#   ./install-node.sh      — на каждой ноде

echo "⚠️  setup.sh устарел. Используйте:"
echo "   ./install-control.sh  — Control Panel (главный сервер)"
echo "   ./install-node.sh     — Node Agent (нода)"
echo ""
read -p "Запустить install-control.sh? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  exec ./install-control.sh
fi
exit 0
