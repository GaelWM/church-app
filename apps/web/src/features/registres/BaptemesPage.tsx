import { Droplets } from "lucide-react";
import { RegistrePage, type RegistreConfig } from "./RegistrePage";

const cfg: RegistreConfig = {
  type: "baptisms", title: "Baptême", newLabel: "Nouveau baptême", newTitle: "Nouveau baptême", editTitle: "Baptême", icon: Droplets,
  fileLabel: "Carte de baptême", searchHint: "Nom, téléphone, email, lieu…", nameOf: (r) => r.fullName,
  fields: [
    { key: "fullName", label: "Nom(s)", required: true },
    { key: "date", label: "Date", kind: "date", required: true },
    { key: "place", label: "Lieu" },
    { key: "pastorName", label: "Pasteur", kind: "pastor" },
    { key: "address", label: "Adresse", full: true },
    { key: "phone", label: "Téléphone", kind: "tel" },
    { key: "whatsapp", label: "WhatsApp", kind: "tel" },
    { key: "email", label: "Email", kind: "email", full: true },
  ],
  columns: [
    { header: "Nom(s)", key: "fullName" }, { header: "Lieu", key: "place" }, { header: "Adresse", key: "address" }, { header: "Téléphone", key: "phone" },
    { header: "Email", key: "email" }, { header: "WhatsApp", key: "whatsapp" }, { header: "Pasteur", key: "pastorName" },
  ],
};
export const BaptemesPage = () => <RegistrePage cfg={cfg} />;
