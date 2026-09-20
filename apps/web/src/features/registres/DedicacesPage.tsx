import { Baby } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RegistrePage, type RegistreConfig } from "./RegistrePage";

const cfg: RegistreConfig = {
  type: "dedications", title: "Dédicace enfants", newLabel: "Nouvelle dédicace", newTitle: "Nouvelle dédicace", editTitle: "Dédicace", icon: Baby,
  fileLabel: "Photo du formulaire de recensement", searchHint: "Enfant, père, mère…", nameOf: (r) => r.childName,
  fields: [
    { key: "date", label: "Date", kind: "date", required: true },
    { key: "childName", label: "Nom de l'enfant", required: true },
    { key: "motherName", label: "Nom de la mère" },
    { key: "fatherName", label: "Nom du père" },
    { key: "pastorName", label: "Nom du pasteur" },
    { key: "formCompleted", label: "Formulaire de recensement complété", kind: "bool" },
  ],
  columns: [
    { header: "Enfant", key: "childName" }, { header: "Mère", key: "motherName" }, { header: "Père", key: "fatherName" }, { header: "Pasteur", key: "pastorName" },
    { header: "Formulaire", key: "formCompleted", text: (r) => (r.formCompleted ? "Oui" : "Non"), cell: (r) => <Badge variant={r.formCompleted ? "default" : "outline"}>{r.formCompleted ? "Complété" : "Non complété"}</Badge> },
  ],
};
export const DedicacesPage = () => <RegistrePage cfg={cfg} />;
