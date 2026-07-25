#!/bin/sh
set -e

CLAMD_CONF="/etc/clamav/clamd.conf"
FRESHCLAM_CONF="/etc/clamav/freshclam.conf"
CLAMD_SOCKET="/run/clamav/clamd.sock"
WORK_GROUP_GID="${WORK_GROUP_GID:-${BUCKET_GROUP_GID:-982}}"

echo "Preparing ClamAV config..."

mkdir -p /run/clamav /var/lib/clamav /var/log/clamav
chown -R clamav:clamav /run/clamav /var/lib/clamav /var/log/clamav
chmod 755 /run/clamav

cat > "$CLAMD_CONF" <<EOF
LogTime yes
Foreground false
DatabaseDirectory /var/lib/clamav
User clamav
LocalSocket $CLAMD_SOCKET
LocalSocketMode 666
FixStaleSocket yes
MaxFileSize 2048M
MaxScanSize 2048M
MaxThreads 2
ReadTimeout 300
CommandReadTimeout 30
SendBufTimeout 200
EOF

cat > "$FRESHCLAM_CONF" <<EOF
DatabaseDirectory /var/lib/clamav
DatabaseOwner clamav
UpdateLogFile /var/log/clamav/freshclam.log
LogTime yes
DatabaseMirror database.clamav.net
EOF

echo "Updating ClamAV database..."
freshclam || echo "freshclam failed, trying to continue with existing DB..."

echo "Starting clamd..."
clamd --config-file="$CLAMD_CONF"

echo "Waiting for clamd socket..."
i=0
while [ ! -S "$CLAMD_SOCKET" ]; do
    i=$((i + 1))

    if [ "$i" -gt 60 ]; then
        echo "clamd socket was not created"
        exit 1
    fi

    sleep 1
done

echo "Testing clamd..."
clamdscan --fdpass --config-file="$CLAMD_CONF" --version

echo "Testing ffmpeg..."
ffmpeg -version | head -n 1
ffprobe -version | head -n 1

echo "Testing native media recovery..."
media-recovery --version

echo "Starting Node worker..."
exec su-exec node:"$WORK_GROUP_GID" "$@"
