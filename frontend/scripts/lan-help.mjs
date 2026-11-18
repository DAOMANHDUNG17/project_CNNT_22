import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { isPrivateIPv4 } from '../config/lan.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = loadEnv('lan', root, 'LAN_TEST_');
const host = env.LAN_TEST_HOST || '<HOST_ONLY_IP>';
console.log(`LAN Test setup (no system settings are changed by this command):
Default: npm run dev serves localhost, 192.168.10.1 and 192.168.20.1 together on port 5173.
Only Host-only addresses already assigned to Windows are opened. Ctrl+C stops all listeners.
The following commands are optional when testing a single interface or trusted HTTPS:
1. Copy frontend/.env.lan.example to frontend/.env.lan.local.
   Set LAN_TEST_HOST to the Windows VirtualBox Host-only IPv4 address.
2. Keep the backend on 127.0.0.1:3000. Frontend LAN requests use /api through Vite.
   HTTP: npm run dev:lan
3. Optional trusted HTTPS: install mkcert manually, then run in frontend/:
   mkcert -install
   mkdir .certs
   mkcert -cert-file .certs/lan-cert.pem -key-file .certs/lan-key.pem ${host} localhost 127.0.0.1
   npm run dev:lan:https
4. On each Xubuntu VM, trust only rootCA.pem from the directory printed by mkcert -CAROOT:
   sudo cp rootCA.pem /usr/local/share/ca-certificates/smart-warehouse-ca.crt
   sudo update-ca-certificates
   Also import this CA into Firefox Authorities if it uses its own certificate store.
   Keep rootCA-key.pem and lan-key.pem on Windows; never copy them to the VMs.
5. Use https://${host}:5173 after CA trust is installed. Do not bypass certificate warnings.
6. After both VM IPs exist, run npm run lan:help -- <VM1_IP> <VM2_IP> to print a narrowly scoped firewall rule.
   Do not expose port 3000 or configure public port forwarding.`);

const ips = process.argv.slice(2);
if (ips.length) {
  if (ips.length !== 2 || !isPrivateIPv4(host) || ips.some(ip => !isPrivateIPv4(ip) || ip === host) || ips[0] === ips[1]) {
    console.error('Provide exactly two distinct private VM IPv4 addresses and configure LAN_TEST_HOST first. No firewall rule was created.');
    process.exitCode = 1;
  } else {
    console.log(`Only after confirming both IPs belong to the Host-only network, run manually in an elevated PowerShell:
New-NetFirewallRule -DisplayName "Smart Warehouse Host-only VMs" -Direction Inbound -Action Allow -Protocol TCP -LocalAddress ${host} -LocalPort 5173 -RemoteAddress ${ips.join(',')} -Profile Private
This command has only been printed; it has not been executed.`);
  }
}
