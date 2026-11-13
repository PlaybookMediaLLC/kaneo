import { PortalSelectContent } from "../../../ui/portal-select-content";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Field,
  FieldLabel,
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../ui/upstream";
export interface RatingScaleProps {
  value: number | null;
  onChange: (rating: number) => void;
}
export function RatingScale({ value, onChange }: RatingScaleProps) {
  const { t } = useTranslation("quills");
  const id = useId();
  const items = [1, 2, 3, 4, 5].map((rating) => ({
    value: rating,
    label: t("csat.ratingLabel", { rating }),
  }));
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("csat.ratingScale")}</FieldLabel>
      <Select
        items={items}
        value={value}
        onValueChange={(rating) => {
          if (rating !== null) onChange(rating);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={t("csat.ratingScale")} />
        </SelectTrigger>
        <PortalSelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </PortalSelectContent>
      </Select>
    </Field>
  );
}
