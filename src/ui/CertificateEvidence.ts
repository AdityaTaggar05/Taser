import { certificateExplorer, type PublicCertificate } from '../certification/public';

export function certificateEvidence(certificate: PublicCertificate) {
  const root = document.createElement('section');
  root.className = 'certificate-evidence';
  root.setAttribute('aria-label', 'Level certification');
  const explorer = certificateExplorer(certificate);
  const link = (label: string, href: string, parent: Element = root) => {
    const anchor = document.createElement('a');
    anchor.textContent = label + ' ↗';
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    parent.append(anchor);
  };
  if (explorer) link('Sepolia certificate', explorer.registry);
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = explorer ? 'How to check this certificate' : 'CRE simulation receipt';
  details.append(summary);
  const paragraph = (text: string) => {
    const p = document.createElement('p');
    p.textContent = text;
    details.append(p);
  };
  const field = (label: string, value: string) => {
    const p = document.createElement('p');
    const code = document.createElement('code');
    p.textContent = label;
    code.textContent = value;
    p.append(code);
    details.append(p);
  };
  if (explorer) {
    paragraph(
      'Open Contract → Read Contract → certifications on Etherscan and paste this certificate ID. Read Contract is available when the registry source is verified.',
    );
    field('Certificate ID', certificate.id);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy certificate ID';
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(certificate.id);
        copy.textContent = 'Certificate ID copied';
      } catch {
        copy.textContent = 'Select and copy the ID above';
      }
    };
    details.append(copy);
    paragraph(`Check exists = true, valid = true and steps = ${certificate.steps}.`);
    field('Expected commitment', certificate.commitment);
    if ('blockNumber' in certificate)
      link(`Checked at Sepolia block ${certificate.blockNumber}`, explorer.observation, details);
    if (certificate.mode === 'simulation')
      paragraph('Local CRE simulation result recorded on Sepolia. This is not DON verification.');
  } else if (certificate.mode === 'cli-simulation') {
    paragraph(
      'Verified by the local CRE CLI. This receipt is stored by WeldPoint; it has no Sepolia certificate.',
    );
    field('Receipt ID', certificate.receiptId);
    field('Workflow hash', certificate.workflowHash);
    paragraph(`Winning solution verified in ${certificate.steps} turns.`);
  } else {
    return;
  }
  root.append(details);
  return root;
}
