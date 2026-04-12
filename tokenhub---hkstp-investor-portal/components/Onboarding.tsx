import React, { useState } from 'react';
import { ShieldCheck, Upload, Camera, Loader2, CheckCircle } from 'lucide-react';
import { KycStatus } from '../types';

interface OnboardingProps {
  onComplete: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleNext = () => {
    setIsSubmitting(true);
    // Simulate API delay
    setTimeout(() => {
      setIsSubmitting(false);
      if (step < 3) {
        setStep(step + 1);
      } else {
        onComplete();
      }
    }, 1500);
  };

  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <div className="mb-8 text-center">
        <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-400 ring-1 ring-blue-500/20">
          <ShieldCheck size={32} />
        </div>
        <h2 className="text-3xl font-bold text-white">Identity Verification</h2>
        <p className="text-gray-400 mt-2">Complete your KYC to access regulated securities trading.</p>
      </div>

      <div className="flex items-center justify-between mb-8 relative">
        <div className="absolute top-1/2 left-0 w-full h-1 bg-white/10 -z-10"></div>
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-4 transition-all duration-300 ${
              step >= s ? 'bg-purple-600 border-purple-800 text-white shadow-lg shadow-purple-500/30' : 'bg-[#0f172a] border-white/10 text-gray-500'
            }`}
          >
            {step > s ? <CheckCircle size={20} /> : s}
          </div>
        ))}
      </div>

      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl shadow-xl p-8">
        {step === 1 && (
          <div className="space-y-6">
            <h3 className="text-xl font-semibold text-white">Personal Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-400">First Name</label>
                <input type="text" className="w-full p-3 rounded-xl bg-black/20 border border-white/10 focus:ring-2 focus:ring-purple-500 outline-none text-white placeholder-gray-600" placeholder="Tai Man" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-400">Last Name</label>
                <input type="text" className="w-full p-3 rounded-xl bg-black/20 border border-white/10 focus:ring-2 focus:ring-purple-500 outline-none text-white placeholder-gray-600" placeholder="Chan" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-400">HKID / Passport Number</label>
              <input type="text" className="w-full p-3 rounded-xl bg-black/20 border border-white/10 focus:ring-2 focus:ring-purple-500 outline-none text-white placeholder-gray-600" placeholder="A123456(7)" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-400">Residential Address</label>
              <textarea className="w-full p-3 rounded-xl bg-black/20 border border-white/10 focus:ring-2 focus:ring-purple-500 outline-none text-white placeholder-gray-600" rows={3} placeholder="Flat A, 10/F..." />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <h3 className="text-xl font-semibold text-white">Document Upload</h3>
            <div className="border-2 border-dashed border-white/20 rounded-xl p-8 flex flex-col items-center justify-center text-center hover:bg-white/5 transition-colors cursor-pointer group">
              <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-gray-400 mb-3 group-hover:text-purple-400 transition-colors">
                <Upload size={24} />
              </div>
              <p className="font-medium text-white">Click to upload HKID or Passport</p>
              <p className="text-sm text-gray-500 mt-1">JPG, PNG or PDF (Max 5MB)</p>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-medium text-white">Liveness Check</h4>
              <div className="bg-white/5 rounded-xl p-4 flex items-center gap-4 border border-white/10">
                <div className="w-12 h-12 bg-black/20 rounded-full flex items-center justify-center shadow-sm">
                  <Camera size={24} className="text-purple-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Facial Verification Required</p>
                  <p className="text-xs text-gray-500">We need to scan your face to verify your identity.</p>
                </div>
                <button className="ml-auto text-sm bg-white/10 border border-white/20 px-3 py-1.5 rounded-lg hover:bg-white/20 text-white transition-colors">Start Scan</button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 text-center">
            <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto text-emerald-400 mb-4 ring-1 ring-emerald-500/20">
              <ShieldCheck size={40} />
            </div>
            <h3 className="text-2xl font-bold text-white">Review In Progress</h3>
            <p className="text-gray-400 max-w-md mx-auto">
              Your documents have been securely transmitted to the HKSTP Compliance Engine. Automated checks usually complete within minutes.
            </p>
            <div className="bg-blue-500/10 p-4 rounded-xl text-left text-sm text-blue-300 border border-blue-500/20 mt-6">
              <p className="font-bold mb-1">Blockchain Identity</p>
              <p>Upon approval, a whitelist credential will be minted to your wallet address, enabling compliant secondary trading via atomic swaps.</p>
            </div>
          </div>
        )}

        <div className="mt-8 flex justify-end">
          <button
            onClick={handleNext}
            disabled={isSubmitting}
            className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-3 rounded-xl font-medium hover:shadow-lg hover:shadow-purple-500/20 disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Processing...
              </>
            ) : step === 3 ? (
              'Complete Setup'
            ) : (
              'Continue'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;