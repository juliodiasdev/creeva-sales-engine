import { useState } from "react";

import { DuplicatesPanel } from "../features/duplicates/DuplicatesPanel";
import { ContactsPage } from "./ContactsPage";

/** Base geral: todas as empresas e contatos coletados, sem duplicados. */
export function BasePage({ onOpenCompany }: { onOpenCompany: (id: number) => void }) {
  const [version, setVersion] = useState(0);

  return (
    <>
      <DuplicatesPanel onChanged={() => setVersion((v) => v + 1)} />
      <ContactsPage key={version} onOpenCompany={onOpenCompany} />
    </>
  );
}
