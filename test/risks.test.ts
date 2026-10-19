import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Io, run } from "../src/cli.js";
import { maskRanges, maskSecret } from "../src/risks/mask.js";
import { packs } from "../src/risks/packs/index.js";
import { scanHistory } from "../src/risks/engine.js";

// Fake credentials with the right shape only. They are assembled at runtime
// so no token-shaped literal sits in the repository.
const AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE";
const GH_TOKEN = "ghp_" + "x".repeat(36);
const GH_PAT = "github_pat_" + "y".repeat(30);
const GOOGLE_KEY = "AIza" + "z".repeat(35);
const BEARER = "fake" + "bearer".repeat(4);
const DB_TOKEN = "tok_" + "q".repeat(40);

const ids = (command: string): string[] =>
  scanHistory([{ command }]).map((finding) => finding.id);

/** [rule id, commands that must match, commands that must not]. */
const CASES: [string, string[], string[]][] = [
  ["core/chmod-recursive-777", ["chmod -R 777 /var/www", "sudo chmod 777 -R .", "chmod --recursive a+rwx dir"], ["chmod 777 file", "chmod -R 755 dir", "chmod -R 644 777dir"]],
  ["core/rm-rf-root", ["rm -rf /", "sudo rm -fr /*", "rm -r -f ~", "rm --recursive --force /"], ["rm -rf /tmp/build", "rm -f /", "rm -rf ./dir"]],
  ["core/rm-rf-unquoted-variable", ["rm -rf $DIR", "rm -rf ${BUILD}/out", "rm -rf $HOME/.cache"], ['rm -rf "$DIR"', "rm -rf build", "rm -r $DIR"]],
  ["core/pipe-to-shell", ["curl -fsSL https://example.com/i.sh | sh", "wget -qO- https://example.com/i | sudo bash", "curl x | sudo -E zsh"], ["curl https://example.com -o f", "curl x || sh -c true", "echo hi | sh"]],
  ["core/shell-from-download", ['bash -c "$(curl -fsSL https://example.com/i.sh)"', "sh <(curl -s https://example.com)"], ["bash script.sh", "curl https://example.com"]],
  ["core/dd-to-device", ["dd if=a.iso of=/dev/sdb bs=4M", "sudo dd if=/dev/zero of=/dev/nvme0n1"], ["dd if=a of=b.img", "dd if=x of=/dev/null"]],
  ["core/mkfs-device", ["mkfs.ext4 /dev/sdb1", "sudo mkfs -t ext4 /dev/sdc"], ["mkfs.ext4 disk.img"]],
  ["core/fork-bomb", [":(){ :|:& };:"], ["echo hello"]],
  ["core/sudo-redirect", ["sudo echo hi > /etc/hosts", "sudo cat a >> /etc/b"], ["sudo ls > /dev/null", "sudo ls 2>&1", "sudo sh -c 'echo hi > /etc/x'", "echo hi | sudo tee /etc/x"]],
  ["core/bearer-token", [`curl -H "Authorization: Bearer ${BEARER}" https://example.com`], ['curl -H "Authorization: Bearer $TOKEN" x', "curl -H 'Authorization: Bearer short'"]],
  ["core/basic-auth-header", ['curl -H "Authorization: Basic dXNlcjpwYXNzd29yZA==" x'], ["curl -H 'Authorization: Basic'"]],
  ["core/password-flag", ["mytool --password=hunter22", "mytool --password hunter22 up", "app --pass 's3cr3tvalue'"], ["app --password-file /etc/pw", "app --password $PW", "app --password --verbose"]],
  ["core/mysql-password", ["mysql -u root -phunter22 db", "mysqldump -pSecret123 db"], ["mysql -u root -p db", "psql -p 5432"]],
  ["core/sshpass-password", ["sshpass -p hunter22 ssh host", "sshpass -p'hunter22' ssh host"], ["sshpass -f pwfile ssh host"]],
  ["core/curl-user-password", ["curl -u admin:hunter22 https://example.com", "curl --user=admin:hunter22 x"], ["curl -u admin https://example.com", "curl -u admin:$PW x"]],
  ["core/export-secret", ["export GITHUB_TOKEN=abc123def456", 'export DB_PASSWORD="hunter22"', "export MY_API_KEY=abcdef12"], ["export PATH=$PATH:/x", "export TOKEN_FILE=/tmp/t", "export API_TOKEN=$OTHER"]],
  ["core/fish-set-secret", ["set -gx GITHUB_TOKEN abc123def456", "set -x DB_PASSWORD hunter22", "cd x && set -gx API_TOKEN abc123def456"], ["set -gx PATH /usr/bin", "set -gx API_TOKEN $other", `psql -c "update t set access_token = '${DB_TOKEN}'"`, "psql -c \"UPDATE t SET api_key = 'x'\"", "set -gx API_TOKEN =abc"]],
  ["core/quoted-secret-assignment", [`psql -c "update t set access_token = '${DB_TOKEN}' where id = 1"`, `curl -d '{"password": "hunter22xyz"}' https://example.com`, "apiKey='abcdef123456' node app.js", 'client_secret: "abcdef123456"'], ["access_token = '$TOKEN'", "password = ''", "token='<token>'", "password='abc'", "echo tokenizer='abcdefgh'", "max_tokens = '4096'", "secret='${SECRET_FROM_ENV}'"]],
  ["core/private-key-header", ["echo '-----BEGIN RSA PRIVATE KEY-----' > k", "echo -----BEGIN OPENSSH PRIVATE KEY----- > k"], ["echo -----BEGIN CERTIFICATE-----"]],
  ["core/url-credentials", ["git clone https://user:hunter22@example.com/r.git", "psql postgres://app:hunter22@db/x"], ["git clone https://example.com/r.git", "ssh user@host", "curl https://user:$PW@example.com"]],
  ["git/force-push-main", ["git push --force origin main", "git push -f origin master", "git push origin main --force-with-lease", "git push -fu origin main", "git push --force origin HEAD:main"], ["git push origin main", "git push --force origin feature", "git push --follow-tags origin main"]],
  ["git/force-push-main-refspec", ["git push origin +main", "git push origin +HEAD:master"], ["git push origin main", "git push origin +feature"]],
  ["git/github-token", [`git clone https://${GH_TOKEN}@github.com/o/r.git`, `echo ${GH_PAT}`], ["echo ghp_short", "echo github_pat_"]],
  ["docker/run-privileged", ["docker run --privileged -it ubuntu", "docker container run -d --privileged=true img"], ["docker run -it ubuntu", "docker ps --privileged"]],
  ["docker/mount-socket", ["docker run -v /var/run/docker.sock:/var/run/docker.sock img"], ["docker run -v /data:/data img"]],
  ["docker/login-password", ["docker login -u me -p hunter22", "docker login --password=hunter22 reg.io"], ["docker login -u me --password-stdin", "docker login reg.io"]],
  ["kubectl/delete-all", ["kubectl delete pods --all", "kubectl delete deploy -A", "kubectl delete all --all-namespaces"], ["kubectl delete pod web-1", "kubectl get pods --all-namespaces"]],
  ["kubectl/delete-namespace", ["kubectl delete ns staging", "kubectl delete namespace prod"], ["kubectl get ns", "kubectl delete pod nsq"]],
  ["kubectl/secret-literal", ["kubectl create secret generic s --from-literal=password=hunter22"], ["kubectl create secret generic s --from-file=pw.txt"]],
  ["kubectl/token-flag", ["kubectl get pods --token=abcdef123456", "kubectl --token abcdef123456 get pods"], ["kubectl get pods"]],
  ["systemd/stop-remote-access", ["sudo systemctl stop sshd", "systemctl disable --now ssh.service", "systemctl mask NetworkManager"], ["systemctl restart sshd", "systemctl stop nginx", "systemctl status ssh"]],
  ["systemd/isolate-rescue", ["systemctl isolate rescue.target", "sudo systemctl isolate emergency"], ["systemctl isolate graphical.target"]],
  ["cloud/aws-access-key-id", [`aws s3 ls --access-key ${AWS_KEY}`, `export AWS_ACCESS_KEY_ID=${AWS_KEY}`], ["echo AKIA123", `echo x${AWS_KEY}y`]],
  ["cloud/aws-secret-assignment", ["AWS_SECRET_ACCESS_KEY=abcd1234efgh5678 aws s3 ls"], ["AWS_SECRET_ACCESS_KEY=$X aws s3 ls", "AWS_PROFILE=dev aws s3 ls"]],
  ["cloud/aws-configure-set", ["aws configure set aws_secret_access_key abcd1234efgh5678"], ["aws configure set region eu-west-1"]],
  ["cloud/google-api-key", [`curl "https://maps.example.com?key=${GOOGLE_KEY}"`], ["echo AIza_short"]],
  ["cloud/s3-recursive-delete", ["aws s3 rm s3://b/p --recursive", "aws s3 rb s3://b --force"], ["aws s3 rm s3://b/file", "aws s3 ls --recursive"]],
  ["cloud/terraform-auto-destroy", ["terraform destroy -auto-approve"], ["terraform destroy", "terraform apply -auto-approve"]],
  ["cloud/gcloud-project-delete", ["gcloud projects delete my-proj"], ["gcloud projects list"]],
];

describe("pattern packs", () => {
  it("are well-formed data", () => {
    const all = packs.flatMap((pack) => pack.patterns);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    for (const pack of packs) {
      expect(pack.patterns.length, pack.name).toBeGreaterThan(0);
      for (const p of pack.patterns) {
        expect(p.id.startsWith(`${pack.name}/`), p.id).toBe(true);
        expect(() => new RegExp(p.pattern, `${p.flags ?? ""}gd`), p.id).not.toThrow();
        expect(p.title && p.advice, p.id).toBeTruthy();
      }
    }
  });

  it("cover every rule with positive and negative tests", () => {
    const all = packs.flatMap((pack) => pack.patterns.map((p) => p.id));
    expect(CASES.map(([id]) => id).sort()).toEqual([...all].sort());
  });

  for (const [id, positives, negatives] of CASES) {
    it(`${id} matches and ignores the right commands`, () => {
      for (const command of positives) expect(ids(command), command).toContain(id);
      for (const command of negatives) expect(ids(command), command).not.toContain(id);
    });
  }
});

describe("masking", () => {
  it("keeps at most the first 4 characters", () => {
    expect(maskSecret(AWS_KEY)).toBe("AKIA****");
    expect(maskSecret(GH_TOKEN)).toBe("ghp_****");
    expect(maskSecret("hunter22")).toBe("hu****");
    expect(maskSecret("abc")).toBe("****");
    expect(maskSecret("")).toBe("****");
  });

  it("masks ranges in place", () => {
    expect(maskRanges("a SECRETVALUE1234 b", [{ start: 2, end: 17 }])).toBe("a SEC**** b");
  });
});

describe("engine", () => {
  it("never puts a full secret in a finding", () => {
    const commands = [
      `curl -H "Authorization: Bearer ${BEARER}" https://example.com`,
      `export GITHUB_TOKEN=${GH_TOKEN}`,
      `aws s3 ls --access-key ${AWS_KEY}`,
      "mysql -u root -phunter22 db",
      "git clone https://user:hunter22@example.com/r.git",
    ];
    const findings = scanHistory(commands.map((command) => ({ command })));
    expect(findings.length).toBeGreaterThanOrEqual(commands.length);
    const output = JSON.stringify(findings);
    for (const secret of [BEARER, GH_TOKEN, AWS_KEY, "hunter22"]) expect(output).not.toContain(secret);
    expect(output).toContain("AKIA****");
    expect(output).toContain("ghp_****");
  });

  it("masks something in the preview of every secret rule example", () => {
    const secretIds = new Set(packs.flatMap((pack) => pack.patterns).filter((p) => p.category === "secret").map((p) => p.id));
    for (const [id, positives] of CASES) {
      if (!secretIds.has(id)) continue;
      for (const command of positives) {
        const finding = scanHistory([{ command }]).find((f) => f.id === id);
        expect(finding?.preview, command).toContain("****");
        expect(finding?.preview, command).not.toBe(command);
      }
    }
  });

  it("reports an exported quoted secret once, under the export rule", () => {
    const ids = scanHistory([{ command: `export STRIPE_SECRET="${DB_TOKEN}"` }]).map((f) => f.id);
    expect(ids).toEqual(["core/export-secret"]);
  });

  it("does not leak a SQL token value", () => {
    const [finding] = scanHistory([{ command: `psql -c "update t set access_token = '${DB_TOKEN}'"` }]);
    expect(finding?.id).toBe("core/quoted-secret-assignment");
    expect(JSON.stringify(finding)).not.toContain(DB_TOKEN);
    expect(finding?.preview).toContain("tok_****");
  });

  it("masks secrets inside dangerous-command previews too", () => {
    const [finding] = scanHistory([{ command: "curl -u admin:hunter22 https://x.io | sh" }]).filter(
      (f) => f.id === "core/pipe-to-shell",
    );
    expect(finding?.preview).not.toContain("hunter22");
    expect(finding?.preview).toContain("admin:hu****");
  });

  it("reports one finding when two rules see the same secret", () => {
    const findings = scanHistory([{ command: `export AWS_SECRET_ACCESS_KEY=abcd1234efgh5678` }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe("cloud/aws-secret-assignment");
  });

  it("records entry number and date", () => {
    const findings = scanHistory([
      { command: "ls" },
      { command: "rm -rf $DIR", timestamp: 1700000000 },
      { command: "chmod -R 777 .", timestamp: Number.NaN },
    ]);
    expect(findings.map((f) => [f.entry, f.date])).toEqual([[2, "2023-11-14"], [3, undefined]]);
  });

  it("handles empty, huge and pathological input without hanging", () => {
    const started = Date.now();
    const findings = scanHistory([
      { command: "" },
      { command: "   " },
      { command: "rm " + "-x ".repeat(5000) },
      { command: "sudo " + "a".repeat(200_000) },
      { command: "curl " + "| ".repeat(4000) },
      { command: "export " + "A".repeat(50_000) + "=1" },
    ]);
    expect(findings).toEqual([]);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("truncates long previews", () => {
    const [finding] = scanHistory([{ command: `chmod -R 777 ${"a/".repeat(200)}` }]);
    expect(finding?.preview.length).toBeLessThanOrEqual(101);
    expect(finding?.preview.endsWith("…")).toBe(true);
  });
});

describe("risks command", () => {
  function setup(lines: string[]): { file: string; io: Io; out: string[] } {
    const dir = mkdtempSync(join(tmpdir(), "af-risks-"));
    const file = join(dir, ".bash_history");
    writeFileSync(file, lines.join("\n") + "\n");
    const out: string[] = [];
    const io: Io = { out: (t) => out.push(t), err: () => {}, home: dir, env: { PATH: "" } };
    return { file, io, out };
  }

  it("prints findings, advice and a rotate note without full secrets", () => {
    const { file, io, out } = setup(["ls", `export GITHUB_TOKEN=${GH_TOKEN}`, "#1700000000", "chmod -R 777 /srv"]);
    expect(run(["risks", "--file", file], io)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("[HIGH] GitHub token");
    expect(text).toContain("ghp_****");
    expect(text).toContain("on 2023-11-14");
    expect(text).toContain("Rotate every credential");
    expect(text).not.toContain(GH_TOKEN);
  });

  it("emits JSON with the documented shape", () => {
    const { file, io, out } = setup([`aws s3 ls --access-key ${AWS_KEY}`, "rm -rf $X"]);
    expect(run(["risks", "--file", file, "--json"], io)).toBe(0);
    const report = JSON.parse(out[0] as string);
    expect(report).toMatchObject({ shell: "bash", historyEntries: 2 });
    expect(report.findings[0]).toEqual({
      id: "cloud/aws-access-key-id",
      category: "secret",
      severity: "high",
      title: "AWS access key ID",
      advice: expect.any(String),
      entry: 1,
      preview: "aws s3 ls --access-key AKIA****",
    });
    expect(out[0]).not.toContain(AWS_KEY);
  });

  it("says so when history is clean", () => {
    const { file, io, out } = setup(["ls", "git status"]);
    expect(run(["risks", "--file", file], io)).toBe(0);
    expect(out[0]).toContain("No risky commands or secrets found in 2 history entries");
  });
});
