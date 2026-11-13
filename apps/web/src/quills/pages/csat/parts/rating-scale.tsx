import { useTranslation } from "react-i18next";

export interface RatingScaleProps {
  value: number | null;
  onChange: (rating: number) => void;
}

export function RatingScale({ value, onChange }: RatingScaleProps) {
  const { t } = useTranslation("quills");
  return (
    <label className="grid gap-2 font-medium">
      {t("csat.ratingScale")}
      <select
        className="min-h-11 rounded-md border bg-background px-3 py-2"
        onChange={(event) => onChange(Number(event.target.value))}
        value={value ?? ""}
      >
        <option disabled value="">
          {t("csat.ratingScale")}
        </option>
        {[1, 2, 3, 4, 5].map((rating) => (
          <option key={rating} value={rating}>
            {t("csat.ratingLabel", { rating })}
          </option>
        ))}
      </select>
    </label>
  );
}
