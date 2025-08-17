@echo off
cd /d %~dp0
git add .
git commit -m "Обновление с локального ПК"
git push origin main
pause
