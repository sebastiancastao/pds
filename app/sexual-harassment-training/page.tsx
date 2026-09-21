"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// Official California Civil Rights Department (CRD) free online course.
// Every language/role combination below was taken from https://calcivilrights.ca.gov/shpt/
const CRD_SHPT_URL = "https://calcivilrights.ca.gov/shpt/";
const CRD_EMPLOYEE_FAQ_URL = "https://calcivilrights.ca.gov/shptfaq-employee/";
const CRD_EMPLOYER_FAQ_URL = "https://calcivilrights.ca.gov/shptfaq-employer/";
const COURSE_BASE_URL = "https://sexual-harassment-prevention-training.calcivilrights.ca.gov";

const LANGUAGES = [
  { id: "English", label: "English", native: "English" },
  { id: "Spanish", label: "Spanish", native: "Español" },
  { id: "Korean", label: "Korean", native: "한국어" },
  { id: "Chinese", label: "Chinese", native: "中文" },
  { id: "Vietnamese", label: "Vietnamese", native: "Tiếng Việt" },
  { id: "Tagalog", label: "Tagalog", native: "Tagalog" },
] as const;

type LanguageId = (typeof LANGUAGES)[number]["id"];
type CourseKind = "NonSupervisory" | "Supervisory";

const COURSES: {
  kind: CourseKind;
  title: string;
  duration: string;
  audience: string;
}[] = [
  {
    kind: "NonSupervisory",
    title: "Nonsupervisory employees",
    duration: "1 hour",
    audience: "For employees who do not direct, assign, or discipline other employees.",
  },
  {
    kind: "Supervisory",
    title: "Supervisors and managers",
    duration: "2 hours",
    audience:
      "For anyone with authority to hire, assign, direct, reward, or discipline other employees, or to effectively recommend those actions.",
  },
];

// Roles that normally supervise other people. Used only to highlight a suggestion;
// both courses are always available.
const SUPERVISORY_ROLES = new Set(["exec", "manager", "supervisor", "supervisor2", "supervisor3"]);

function courseUrl(kind: CourseKind, language: LanguageId) {
  return `${COURSE_BASE_URL}/${kind}${language}/story.html`;
}

function ExternalIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

export default function SexualHarassmentTrainingPage() {
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState("");
  const [language, setLanguage] = useState<LanguageId>("English");

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        window.location.href = "/login";
        return;
      }
      try {
        const { data } = await supabase
          .from("users")
          .select("role")
          .eq("id", session.user.id)
          .single();
        const value = String((data as { role?: string } | null)?.role ?? "")
          .trim()
          .toLowerCase();
        if (!cancelled) setRole(value);
      } catch {
        // Role is only used to suggest a course, so a failed lookup is not fatal.
      }
      if (!cancelled) setReady(true);
    };
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-500">
        Loading...
      </div>
    );
  }

  const suggestedKind: CourseKind = SUPERVISORY_ROLES.has(role) ? "Supervisory" : "NonSupervisory";
  const selectedLanguage = LANGUAGES.find((l) => l.id === language) ?? LANGUAGES[0];

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
            &larr; Back to Dashboard
          </Link>
          <a
            href={CRD_SHPT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
          >
            CRD training page <ExternalIcon />
          </a>
        </div>

        <header className="mb-8">
          <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Sexual Harassment Prevention Training</h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            California requires sexual harassment prevention training for employees and supervisors. The California
            Civil Rights Department offers the course online in six languages. Pick your language, take the course
            for your role, and keep the certificate it gives you at the end.
          </p>
        </header>

        {/* Step 1: language */}
        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">1. Choose your language</h2>
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Training language">
            {LANGUAGES.map((l) => {
              const active = l.id === language;
              return (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setLanguage(l.id)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-700"
                  }`}
                >
                  {l.native === l.label ? l.label : `${l.label} · ${l.native}`}
                </button>
              );
            })}
          </div>
        </section>

        {/* Step 2: course */}
        <section className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-gray-900">2. Start the course for your role</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {COURSES.map((course) => {
              const suggested = course.kind === suggestedKind;
              return (
                <div
                  key={course.kind}
                  className={`flex flex-col rounded-xl border bg-white p-5 shadow-sm ${
                    suggested ? "border-blue-500 ring-1 ring-blue-500" : "border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-semibold text-gray-900">{course.title}</h3>
                    {suggested && (
                      <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                        Suggested for you
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-medium text-gray-500">About {course.duration}</p>
                  <p className="mt-3 flex-1 text-sm text-gray-600">{course.audience}</p>
                  <a
                    href={courseUrl(course.kind, language)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`mt-5 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                      suggested
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                    }`}
                  >
                    Start in {selectedLanguage.label} <ExternalIcon />
                  </a>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            The course opens on the California Civil Rights Department website in a new tab. If you supervise anyone,
            take the supervisors course.
          </p>
        </section>

        {/* Step 3: certificate */}
        <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-base font-semibold text-amber-900">3. Save your certificate</h2>
          <p className="mt-2 text-sm text-amber-900">
            At the end of the course you are asked to enter your information to generate a certificate of completion.
            Save it, print it, or take a photo of it. The state cannot email you a replacement, so keep a copy and give
            one to HR.
          </p>
        </section>

        {/* Requirements */}
        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">When you need to complete it</h2>
          <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm font-medium text-gray-900">New hires and new supervisors</dt>
              <dd className="mt-1 text-sm text-gray-600">Within 6 months of hire, or of promotion to a supervisory role.</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-900">Seasonal and temporary staff</dt>
              <dd className="mt-1 text-sm text-gray-600">
                Within 30 calendar days of hire or 100 hours worked, whichever comes first.
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-900">Refresher</dt>
              <dd className="mt-1 text-sm text-gray-600">Every 2 years after that.</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-gray-500">
            Summarized from California Government Code section 12950.1. Ask HR if you are not sure which course or
            deadline applies to you.
          </p>
        </section>

        {/* Resources */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">More information</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a
                href={CRD_EMPLOYEE_FAQ_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-blue-600 hover:underline"
              >
                Training FAQ for employees <ExternalIcon />
              </a>
            </li>
            <li>
              <a
                href={CRD_EMPLOYER_FAQ_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-blue-600 hover:underline"
              >
                Training FAQ for employers and supervisors <ExternalIcon />
              </a>
            </li>
            <li>
              <a
                href={CRD_SHPT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-blue-600 hover:underline"
              >
                California Civil Rights Department training page <ExternalIcon />
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
