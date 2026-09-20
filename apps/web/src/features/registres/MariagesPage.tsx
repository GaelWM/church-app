import { Heart } from "lucide-react";
import { RegistrePage, type RegistreConfig } from "./RegistrePage";

const cfg: RegistreConfig = {
  type: "marriages", title: "Mariage", newLabel: "Nouveau mariage", newTitle: "Nouveau mariage", editTitle: "Mariage", icon: Heart,
  fileLabel: "Certificat de mariage", searchHint: "Époux, épouse, téléphone…", nameOf: (r) => `${r.husbandName} & ${r.wifeName}`,
  fields: [
    { key: "husbandName", label: "Nom de l'époux", required: true },
    { key: "wifeName", label: "Nom de l'épouse", required: true },
    { key: "date", label: "Date", kind: "date", required: true },
    { key: "pastorName", label: "Pasteur", kind: "pastor" },
    { key: "blessingPlace", label: "Lieu de la bénédiction" },
    { key: "phone", label: "Téléphone", kind: "tel" },
    { key: "coupleAddress", label: "Adresse du couple", full: true },
  ],
  columns: [
    { header: "Époux", key: "husbandName" }, { header: "Épouse", key: "wifeName" }, { header: "Adresse", key: "coupleAddress" }, { header: "Téléphone", key: "phone" },
    { header: "Pasteur", key: "pastorName" }, { header: "Lieu de bénédiction", key: "blessingPlace" },
  ],
};
export const MariagesPage = () => <RegistrePage cfg={cfg} />;
