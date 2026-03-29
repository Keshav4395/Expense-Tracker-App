import React, { useState } from 'react';
import { Briefcase, GraduationCap, ArrowRight } from 'lucide-react';

const Step1UserType = ({ onNext }) => {
  const [userType, setUserType] = useState('');

  const handleNext = () => {
    if (userType) {
      onNext({ userType });
    } else {
      alert('Please select your employment status');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            Let's Get to Know You
          </h1>
          <p className="text-gray-600 text-lg">
            Step 1 of 5 • This helps us personalize your experience
          </p>
          <div className="w-full bg-gray-200 h-2 rounded-full mt-6">
            <div className="bg-purple-600 h-2 rounded-full" style={{ width: '20%' }} />
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">
            What's your current status?
          </h2>
          
          <div className="grid grid-cols-2 gap-6">
            <button
              onClick={() => setUserType('salaried')}
              className={`p-8 rounded-2xl border-2 transition-all ${
                userType === 'salaried'
                  ? 'border-purple-600 bg-purple-50'
                  : 'border-gray-200 hover:border-purple-300'
              }`}
            >
              <Briefcase className={`w-16 h-16 mb-4 mx-auto ${
                userType === 'salaried' ? 'text-purple-600' : 'text-gray-400'
              }`} />
              <h3 className="text-xl font-semibold text-gray-800 mb-2">Salaried</h3>
              <p className="text-gray-600 text-sm">I receive a regular salary</p>
            </button>

            <button
              onClick={() => setUserType('student')}
              className={`p-8 rounded-2xl border-2 transition-all ${
                userType === 'student'
                  ? 'border-purple-600 bg-purple-50'
                  : 'border-gray-200 hover:border-purple-300'
              }`}
            >
              <GraduationCap className={`w-16 h-16 mb-4 mx-auto ${
                userType === 'student' ? 'text-purple-600' : 'text-gray-400'
              }`} />
              <h3 className="text-xl font-semibold text-gray-800 mb-2">Student</h3>
              <p className="text-gray-600 text-sm">I'm currently studying</p>
            </button>
          </div>
        </div>

        <button
          onClick={handleNext}
          disabled={!userType}
          className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-4 rounded-xl font-semibold text-lg hover:from-purple-700 hover:to-pink-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          Continue
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default Step1UserType;