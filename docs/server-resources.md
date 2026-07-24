# Server Resources And Media Processing Capacity

This document records the current production server resources for PvP Scalpel and the practical limits for media upload, malware scanning, and later processing work.

The numbers below are based on the measured `lychcloud` host output from July 2026.

## Current Host

CPU:

- Intel Core i7-6700K @ 4.00 GHz
- 4 physical cores / 8 threads
- AVX2 capable

Memory:

- 16 GiB total
- 2 x 8 GiB DDR4 DIMMs
- Configured speed: 2133 MT/s
- Non-ECC
- Around 10 GiB available during the observed check
- 4 GiB swap configured

Disk:

- 1 TB WDC WD10JPVX spinning HDD
- Docker volumes, MinIO/S3 data, Redis data, and ClamAV data all live on the same filesystem
- Measured buffered disk read speed: about 102 MB/s
- Disk free space during the observed check: about 810 GiB

GPU:

- GTX 1060 6 GB is planned for local AI moderation/legal checks
- ClamAV scanning does not use this GPU

## Main Bottlenecks

The current main bottleneck is disk I/O, not RAM.

The HDD is shared by:

- MinIO uploads writing video chunks
- ClamAV reading quarantine files for malware scans
- media processing reading and writing files
- Docker volume activity
- Redis persistence
- app logs and container filesystem work

Cloudflare cache helps with public download/view traffic, but it does not reduce the local cost of uploads, ClamAV scans, or media processing.

## Current ClamAV Worker Settings

The worker container starts `clamd` with:

```text
MaxFileSize 2048M
MaxScanSize 2048M
MaxThreads 2
ReadTimeout 300
CommandReadTimeout 30
SendBufTimeout 200
```

These settings are reasonable for the current upload design where video is split into chunks of about 90 MB each.

Do not scan the whole MinIO bucket root during normal operation. Only scan the specific quarantine path for one media item, for example:

```text
/mnt/s3-bucket/quarantine-uploads/<mediaId>
```

## Expected Scan Cost

MIME checks based on magic bytes are cheap. They read only the first few KB of each file and should complete in milliseconds even for large files.

ClamAV scans must read file contents. With the current HDD measured at about 102 MB/s sequential reads, realistic scan time is likely:

```text
1 x 90 MB chunk   about 1-5 seconds under normal load
10 x 90 MB chunks about 10-50 seconds
100 x 90 MB chunks about 2-8 minutes
```

These are estimates. Uploads, other scans, and media processing on the same HDD can increase the time significantly.

## Safe Operating Limits

Use conservative processing limits on the current host:

- Run one media processing job at a time.
- Scan one media folder at a time.
- Keep ClamAV `MaxThreads` at `2`; lower to `1` if the server feels sluggish during scans.
- Keep chunk size around 90-100 MB.
- Use a short timeout for per-chunk scans, around 2 minutes.
- Use a longer timeout for one complete media folder scan, around 15-30 minutes.
- Avoid scanning `/mnt/s3-bucket` or `/mnt/s3-bucket/quarantine-uploads` globally in normal worker flow.

Multiple simultaneous large media scan/process jobs can overwhelm the HDD and make the server feel stuck.

## Upgrade Priority

Upgrade order if the server becomes slow:

1. Move Docker volumes / MinIO data to SSD or NVMe.
2. Increase RAM to 32 GiB if memory pressure appears.
3. Upgrade CPU only if ClamAV or media processing stays CPU-bound after the disk upgrade.

SSD/NVMe is the highest-impact upgrade for this workload because the current HDD is the slowest component in the upload/scan/process path.

## Monitoring Commands

Watch container resource use:

```sh
docker stats
docker stats pvp-s-workers
```

Watch CPU and process pressure:

```sh
htop
```

Watch disk pressure:

```sh
iostat -xz 1
```

Check disk speed:

```sh
sudo hdparm -Tt /dev/sda
```

Check memory:

```sh
free -h
sudo dmidecode -t memory
```

Check GPU use:

```sh
nvidia-smi
watch -n 1 nvidia-smi
```

## Practical Conclusion

The current host is acceptable for early production if media processing is serialized and quarantine scans are scoped to one media item at a time.

The setup is not safe for many concurrent large media uploads and scans. If media usage grows, the first production upgrade should be SSD/NVMe-backed Docker and MinIO volumes.
